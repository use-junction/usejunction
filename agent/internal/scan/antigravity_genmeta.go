package scan

import (
	"database/sql"
	"encoding/binary"
	"os"
	"time"

	"github.com/usejunction/agent/internal/sqlitedb"
	"github.com/usejunction/agent/internal/types"
)

// antigravityGenMetaHit is one generation decoded from gen_metadata protobuf.
// Field map (tokscale/splitrail reverse-engineering of GeneratorMetadata):
//
//	gen_metadata.#1              → chatModel
//	chatModel.#19 (string)       → responseModel
//	chatModel.#9.#4              → {#1 seconds, #2 nanos} per-turn timestamp
//	chatModel.#4                 → usage
//	usage.#1 + #2 (varint)       → input (fixed system prompt + new input)
//	usage.#5 (varint)            → cacheRead
//	usage.#9 (varint)            → output text
//	usage.#10 (varint)           → thinking / reasoning
//	usage.#11 (string)           → responseId (dedupe key)
type antigravityGenMetaHit struct {
	Model      string
	Date       string
	Input      int
	Output     int
	CacheRead  int
	Reasoning  int
	ResponseID string
}

func scanAntigravityGenMetadata(dbPath string, buckets map[string]*types.DailyUsage, seen map[string]bool) error {
	if _, err := os.Stat(dbPath); err != nil {
		return err
	}
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	sessionDate := loadAntigravitySessionDate(db, dbPath)
	rows, err := db.Query(`SELECT data FROM gen_metadata ORDER BY idx`)
	if err != nil {
		return nil // table missing → not a gen_metadata DB
	}
	defer rows.Close()

	for rows.Next() {
		var blob []byte
		if err := rows.Scan(&blob); err != nil || len(blob) == 0 {
			continue
		}
		hit, ok := parseAntigravityGenMetadata(blob, sessionDate)
		if !ok {
			continue
		}
		if hit.ResponseID != "" {
			if seen[hit.ResponseID] {
				continue
			}
			seen[hit.ResponseID] = true
		}
		b := antigravityBucket(buckets, hit.Date, hit.Model, antigravityUsageSource)
		b.InputTokens += hit.Input
		b.OutputTokens += hit.Output
		b.CacheReadTokens += hit.CacheRead
		b.ReasoningTokens += hit.Reasoning
		b.Requests++
	}
	return rows.Err()
}

func loadAntigravitySessionDate(db *sql.DB, dbPath string) string {
	var blob []byte
	err := db.QueryRow(`SELECT data FROM trajectory_metadata_blob LIMIT 1`).Scan(&blob)
	if err == nil {
		if ms, ok := protoTimestampMillis(protoMessageField(blob, 2)); ok && ms > 0 {
			return time.UnixMilli(ms).UTC().Format("2006-01-02")
		}
	}
	if info, err := os.Stat(dbPath); err == nil {
		return info.ModTime().UTC().Format("2006-01-02")
	}
	return time.Now().UTC().Format("2006-01-02")
}

func parseAntigravityGenMetadata(blob []byte, sessionDate string) (antigravityGenMetaHit, bool) {
	chatModel := protoMessageField(blob, 1)
	if chatModel == nil {
		return antigravityGenMetaHit{}, false
	}
	usage := protoMessageField(chatModel, 4)
	if usage == nil {
		return antigravityGenMetaHit{}, false
	}

	input := int(protoVarintField(usage, 1)) + int(protoVarintField(usage, 2))
	cacheRead := int(protoVarintField(usage, 5))
	output := int(protoVarintField(usage, 9))
	reasoning := int(protoVarintField(usage, 10))
	if input+output+cacheRead+reasoning == 0 {
		return antigravityGenMetaHit{}, false
	}

	date := sessionDate
	if gen := protoMessageField(chatModel, 9); gen != nil {
		if ms, ok := protoTimestampMillis(protoMessageField(gen, 4)); ok && ms > 0 {
			date = time.UnixMilli(ms).UTC().Format("2006-01-02")
		}
	}

	model := "unknown"
	if raw := protoStringField(chatModel, 19); raw != "" {
		if normalized := normalizeAntigravityModelName(raw); normalized != "" {
			model = normalized
		} else {
			model = raw
		}
	}

	return antigravityGenMetaHit{
		Model:      model,
		Date:       date,
		Input:      input,
		Output:     output,
		CacheRead:  cacheRead,
		Reasoning:  reasoning,
		ResponseID: protoStringField(usage, 11),
	}, true
}

func protoTimestampMillis(ts []byte) (int64, bool) {
	if ts == nil {
		return 0, false
	}
	sec := int64(protoVarintField(ts, 1))
	nanos := int64(protoVarintField(ts, 2))
	if sec <= 0 {
		return 0, false
	}
	ms := sec*1000 + nanos/1_000_000
	return ms, true
}

type protoWireKind int

const (
	protoWireVarint  protoWireKind = 0
	protoWireFixed64 protoWireKind = 1
	protoWireBytes   protoWireKind = 2
	protoWireFixed32 protoWireKind = 5
)

func protoMessageField(buf []byte, field uint64) []byte {
	for _, item := range protoIterate(buf) {
		if item.field == field && item.kind == protoWireBytes {
			return item.bytes
		}
	}
	return nil
}

func protoStringField(buf []byte, field uint64) string {
	b := protoMessageField(buf, field)
	if b == nil {
		return ""
	}
	return string(b)
}

func protoVarintField(buf []byte, field uint64) uint64 {
	for _, item := range protoIterate(buf) {
		if item.field == field && item.kind == protoWireVarint {
			return item.varint
		}
	}
	return 0
}

type protoField struct {
	field  uint64
	kind   protoWireKind
	varint uint64
	bytes  []byte
}

func protoIterate(buf []byte) []protoField {
	var out []protoField
	i := 0
	for i < len(buf) {
		tag, n := binary.Uvarint(buf[i:])
		if n <= 0 {
			break
		}
		i += n
		field := tag >> 3
		kind := protoWireKind(tag & 7)
		switch kind {
		case protoWireVarint:
			v, n := binary.Uvarint(buf[i:])
			if n <= 0 {
				return out
			}
			i += n
			out = append(out, protoField{field: field, kind: kind, varint: v})
		case protoWireFixed64:
			if i+8 > len(buf) {
				return out
			}
			i += 8
		case protoWireBytes:
			l, n := binary.Uvarint(buf[i:])
			if n <= 0 {
				return out
			}
			i += n
			end := i + int(l)
			if end > len(buf) || end < i {
				return out
			}
			out = append(out, protoField{field: field, kind: kind, bytes: buf[i:end]})
			i = end
		case protoWireFixed32:
			if i+4 > len(buf) {
				return out
			}
			i += 4
		default:
			return out
		}
	}
	return out
}

// Encode helpers used by tests to build synthetic gen_metadata blobs.

func encodeProtoVarint(v uint64) []byte {
	var buf [10]byte
	n := binary.PutUvarint(buf[:], v)
	return append([]byte(nil), buf[:n]...)
}

func encodeProtoTag(field uint64, kind protoWireKind) []byte {
	return encodeProtoVarint(field<<3 | uint64(kind))
}

func EncodeProtoVarintField(field uint64, value uint64) []byte {
	out := encodeProtoTag(field, protoWireVarint)
	return append(out, encodeProtoVarint(value)...)
}

func EncodeProtoBytesField(field uint64, payload []byte) []byte {
	out := encodeProtoTag(field, protoWireBytes)
	out = append(out, encodeProtoVarint(uint64(len(payload)))...)
	return append(out, payload...)
}

func EncodeProtoStringField(field uint64, s string) []byte {
	return EncodeProtoBytesField(field, []byte(s))
}

// BuildAntigravityGenMetadataBlob builds a minimal gen_metadata protobuf for tests.
func BuildAntigravityGenMetadataBlob(model, responseID string, inputFixed, inputNew, cacheRead, output, thinking uint64, unixSec int64) []byte {
	usage := append([]byte(nil), EncodeProtoVarintField(1, inputFixed)...)
	usage = append(usage, EncodeProtoVarintField(2, inputNew)...)
	if cacheRead > 0 {
		usage = append(usage, EncodeProtoVarintField(5, cacheRead)...)
	}
	usage = append(usage, EncodeProtoVarintField(9, output)...)
	if thinking > 0 {
		usage = append(usage, EncodeProtoVarintField(10, thinking)...)
	}
	if responseID != "" {
		usage = append(usage, EncodeProtoStringField(11, responseID)...)
	}

	ts := append([]byte(nil), EncodeProtoVarintField(1, uint64(unixSec))...)
	genInfo := EncodeProtoBytesField(4, ts)

	chat := append([]byte(nil), EncodeProtoBytesField(4, usage)...)
	chat = append(chat, EncodeProtoBytesField(9, genInfo)...)
	chat = append(chat, EncodeProtoStringField(19, model)...)
	return EncodeProtoBytesField(1, chat)
}

// BuildAntigravityTrajectoryMetaBlob builds trajectory_metadata_blob for tests.
func BuildAntigravityTrajectoryMetaBlob(unixSec int64, workspaceURI string) []byte {
	var out []byte
	if workspaceURI != "" {
		folder := EncodeProtoStringField(1, workspaceURI)
		out = append(out, EncodeProtoBytesField(1, folder)...)
	}
	ts := EncodeProtoVarintField(1, uint64(unixSec))
	out = append(out, EncodeProtoBytesField(2, ts)...)
	return out
}

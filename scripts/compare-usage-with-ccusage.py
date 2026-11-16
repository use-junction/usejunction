#!/usr/bin/env python3
"""Compare the agent's usage table with ccusage on this machine's logs.

Both tools read the same local files. Token counts should match exactly per
model; costs differ wherever the two price lists differ.

    cd agent && go build -o /tmp/usejunction . && cd ..
    scripts/compare-usage-with-ccusage.py /tmp/usejunction 20261101 20261115

Pick whole days that are over. Days are UTC on both sides. The agent runs with
a throwaway data folder, so an installed agent is not touched. ccusage is
fetched with npx and downloads its price list.
"""
import collections
import json
import subprocess
import sys
import tempfile


def run_json(command):
    return json.loads(subprocess.run(command, check=True, capture_output=True, text=True).stdout)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    agent, since, until = sys.argv[1:]
    with tempfile.TemporaryDirectory() as home:
        ours = run_json([agent, "--home", home, "daily", "--since", since, "--until", until, "--breakdown", "--json"])
    theirs = run_json(["npx", "--yes", "ccusage@latest", "daily", "--since", since, "--until", until, "--timezone", "UTC", "--json"])

    fields = ("input", "output", "cache write", "cache read")
    ours_by_model = collections.defaultdict(collections.Counter)
    for row in ours["daily"]:
        for line in row["modelBreakdown"]:
            tally = ours_by_model[line["model"]]
            for field, key in zip(fields, ("inputTokens", "outputTokens", "cacheWriteTokens", "cacheReadTokens")):
                tally[field] += line[key]
            tally["cost"] += line["estimatedCost"]
    theirs_by_model = collections.defaultdict(collections.Counter)
    for row in theirs["daily"]:
        for line in row["modelBreakdowns"]:
            tally = theirs_by_model[line["modelName"].removeprefix("claude-")]
            for field, key in zip(fields, ("inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens")):
                tally[field] += line[key]
            tally["cost"] += line["cost"]

    tokens_match = True
    print(f"{'model':<24}{'tokens':<44}{'our cost':>10}{'ccusage':>10}")
    for model in sorted(set(ours_by_model) | set(theirs_by_model)):
        mine, other = ours_by_model[model], theirs_by_model[model]
        gaps = {field: mine[field] - other[field] for field in fields if mine[field] != other[field]}
        tokens_match = tokens_match and not gaps
        print(f"{model:<24}{('same' if not gaps else str(gaps)):<44}{mine['cost']:>10.2f}{other['cost']:>10.2f}")
    print(f"{'total':<68}{ours['totals']['estimatedCost']:>10.2f}{theirs['totals']['totalCost']:>10.2f}")
    print("Token counts match." if tokens_match else "Token counts differ.")
    sys.exit(0 if tokens_match else 1)


if __name__ == "__main__":
    main()

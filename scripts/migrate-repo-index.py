"""
Migrate repo_index.json into canopy.json.

One-time migration script that imports curated items from a legacy
repo_index.json into the CanopyTag canopy.json format. Preserves
existing canopy data — only fills in fields that are currently empty.

Usage:
    python scripts/migrate-repo-index.py

After running, canopy.json becomes the single source of truth and
repo_index.json is legacy.
"""

import json
import os
from datetime import datetime, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
REPO_INDEX_PATH = os.path.join(REPO_ROOT, 'docs', '_meta', 'repo_index.json')
CANOPY_PATH = os.path.join(os.path.dirname(__file__), '..', 'workspace', 'canopy.json')

# Authority level mapping (repo_index uses same values)
AUTHORITY_MAP = {
    'idea': 'idea',
    'blueprint': 'blueprint',
    'guideline': 'guideline',
    'specification': 'specification',
    'standard': 'standard',
}


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Wrote {path}")


def migrate():
    print(f"Repo root: {REPO_ROOT}")
    print(f"Source:    {REPO_INDEX_PATH}")
    print(f"Target:    {CANOPY_PATH}")
    print()

    if not os.path.exists(REPO_INDEX_PATH):
        print("ERROR: repo_index.json not found")
        return

    repo_index = load_json(REPO_INDEX_PATH)
    canopy = load_json(CANOPY_PATH) if os.path.exists(CANOPY_PATH) else {
        "version": 1,
        "repo_root": REPO_ROOT,
        "last_modified_at": datetime.now(timezone.utc).isoformat(),
        "files": {},
        "directories": {},
        "features": {},
    }

    items = repo_index.get('items', [])
    migrated = 0
    skipped = 0

    for item in items:
        path = item.get('path', '')
        if not path:
            continue

        # Initialize entry if it doesn't exist
        if path not in canopy['files']:
            canopy['files'][path] = {}

        entry = canopy['files'][path]

        # Only fill fields that are currently empty (canopy wins)
        def set_if_empty(canopy_key, value):
            if value and not entry.get(canopy_key):
                entry[canopy_key] = value

        set_if_empty('title', item.get('title'))
        set_if_empty('summary', item.get('summary'))
        set_if_empty('authority_level', AUTHORITY_MAP.get(item.get('authority_level', ''), None))
        set_if_empty('status', item.get('status'))
        set_if_empty('last_reviewed', item.get('last_reviewed'))

        # Tags — merge, don't replace
        existing_tags = set(entry.get('tags', []))
        new_tags = set(item.get('tags', []))
        merged_tags = sorted(existing_tags | new_tags)
        if merged_tags:
            entry['tags'] = merged_tags

        # Related files — merge related_docs + related_tests into related_files
        existing_related = set(entry.get('related_files', []))
        for rel in item.get('related_docs', []):
            existing_related.add(rel)
        for rel in item.get('related_tests', []):
            existing_related.add(rel)
        if existing_related:
            entry['related_files'] = sorted(existing_related)

        # I/O metadata — for entrypoints and scripts
        inputs = item.get('inputs')
        outputs = item.get('outputs')
        if (inputs or outputs) and not entry.get('io_metadata'):
            io_meta = {}
            if inputs:
                io_meta['inputs'] = inputs if isinstance(inputs, list) else [inputs]
            if outputs:
                io_meta['outputs'] = outputs if isinstance(outputs, list) else [outputs]
            entry['io_metadata'] = io_meta

        # Quality scores — only fill if canopy doesn't have them
        for dim in ['validity', 'clarity', 'completeness', 'stability']:
            score = item.get(dim)
            if score and not entry.get(dim):
                entry[dim] = score

        # Initialize empty arrays if not present
        if 'todos' not in entry:
            entry['todos'] = []
        if 'comments' not in entry:
            entry['comments'] = []

        # Map subsystem to feature_id if no feature assigned
        subsystem = item.get('subsystem')
        if subsystem and not entry.get('feature_id'):
            entry['feature_id'] = subsystem

        migrated += 1
        print(f"  Migrated: {path}")

    canopy['last_modified_at'] = datetime.now(timezone.utc).isoformat()

    save_json(CANOPY_PATH, canopy)
    print(f"\nDone. Migrated {migrated} items, skipped {skipped}.")
    print(f"canopy.json now has {len(canopy['files'])} file entries.")


if __name__ == '__main__':
    migrate()

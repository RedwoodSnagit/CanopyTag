# Species Import Notes

This document is a draft for a future import API. The current demo is a local
CLI, but this sketch gives agents something intentionally lower-authority to
compare with the stable architecture doc.

## Proposed JSON Input

```json
{
  "observations": [
    {
      "species": "red oak",
      "role": "producer",
      "count": 7,
      "native": true,
      "canopy_layer": "canopy",
      "threat_score": 1
    }
  ]
}
```

## Open Questions

- Should observations require a confidence score?
- Should imported food-web edges be directed or bidirectional?
- Should invasive pressure be calculated from observations or config?

# fifa-career-mode-player-search

A FIFA career mode style scouting backend. Give it a reference player or a target profile and it returns the best matches from the Premier League, La Liga and Bundesliga, with the top stats behind each match and a radar chart.

The notebook is `notebooks/scouting_model.ipynb`. It exports two JSON files to `export/` for a static site that does all filtering in JavaScript.

## Data sources and attribution
All data is downloaded by the notebook and cached in `raw/` (not committed).

- [transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets) (dcaribou, CC0), built from [Transfermarkt](https://www.transfermarkt.com): age, position, height, market value, contract expiry, club, appearances and match results.
- [soccerdata](https://github.com/probberechts/soccerdata) (Apache 2.0): scraper library.
- [FBref](https://fbref.com) is tried first. It blocks automated access, so the notebook falls back to [Understat](https://understat.com): xG, xA, npxG, shots, key passes, xG chain, xG buildup.
- FBref snapshots on Kaggle by hubertsidorowicz ([2024/25](https://www.kaggle.com/datasets/hubertsidorowicz/football-players-stats-2024-2025), [2025/26](https://www.kaggle.com/datasets/hubertsidorowicz/football-players-stats-2025-2026)), downloaded anonymously: tackles, interceptions, clearances, blocks, recoveries, aerials, goalkeeper saves. Advanced FBref stats exist only for 2024/25.

Check each site's terms before reusing data. Only derived per-90 values are exported.

## Run on Kaggle
1. Create a new notebook, upload `notebooks/scouting_model.ipynb`, and turn Internet on.
2. Run all cells. The first run is slow because of polite rate limiting. Later runs use the cache in `/kaggle/working/raw/`.
3. Download `players.json` and `similar_players.json` from `/kaggle/working/export/` into this repo's `export/` folder.

## How it works
Per-90 stats, compared only inside a position group (GK, CB, FB, DM/CM, AM/W, ST), standardised, ranked by RMS gap in z-scores. `similarity = 1 / (1 + rms_gap)`. KMeans (fixed k) labels roles.

Defenders, midfielders and goalkeepers use the FBref Kaggle snapshots plus Transfermarkt-derived signals (cards, height, goalkeeper clean sheets). If the snapshots fail to download, those groups are flagged `limited`.

## Export schema
`export/players.json`: list of records
- `id`, `name`, `club`, `league`, `age`, `position_group`, `position`, `market_value_eur`, `contract_expiry`, `minutes`
- `role`: cluster label, `profile_quality`: `ok` or `limited`
- `stats`: per-90 values by stat key, `pct`: percentile (0 to 100) within the position group

`export/similar_players.json`: object keyed by player id (string), each a list of up to 20 `{id, score, top}`
- `score`: similarity from 0 to 1
- `top`: the 3 stat keys where the match is closest to the reference

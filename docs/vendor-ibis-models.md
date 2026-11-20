# Local vendor IBIS models

Install `unzip`, then run these commands from the repository root:

```sh
export IBIS_MODEL_DIR="$PWD/models"
bun run fetch:vendor-models
bun test
```

The fetch script uses `IBIS_MODEL_DIR` as its destination and defaults to the
gitignored `models/` directory. It verifies each download and extracted model
against `examples/vendor-models.lock.json`. It also verifies existing files.
If an existing file fails verification, remove that file and run the fetch again.

CI caches the models using the lock file hash and runs the fetch script before each
test run. The five vendor channel tests require `IBIS_MODEL_DIR` and fail if
their models are missing or modified.

The manufacturers retain copyright. Keep the files local and follow the vendors' redistribution terms.

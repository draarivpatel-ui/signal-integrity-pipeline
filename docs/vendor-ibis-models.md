# Local vendor IBIS models

For each entry in `examples/vendor-models.lock.json`, download the ZIP from
`url` and verify its SHA-256 against `archiveSha256`. Extract the member at
`archivePath` as `file` and verify it against `sha256`. Put the extracted
files in the directory named by `IBIS_MODEL_DIR` to enable the vendor channel tests.

The manufacturers retain copyright. Keep the files local and follow the vendors' redistribution terms.

## Routed examples

The routed CMOS example uses `LVC1G04_DBV` from the locked CMOS file. The
1.5 V DDR3 examples declare their signal models in
`examples/level4-ddr3-write/level4-ddr3-write.tsx` and
`examples/routed/ddr3-signals.tsx`, using the locked AM335x and Winbond files.

The AM335x package conversion negates 30,450 off-diagonal capacitance entries
in a copy under the uniform-positive, diagonally dominant magnitude
interpretation before checking Maxwell signs and passivity. The original
package bytes stay intact.

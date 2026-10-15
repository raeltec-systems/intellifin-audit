# Executed gate history

Original log bytes are retained, including failed fixtures and expected negative controls. Only the final gates below attest the checkpoint source.

| Gate | Result | Receipt |
| --- | --- | --- |
| boundaries-final | Earlier pass; superseded source | [record](boundaries-final-receipt.json) |
| boundaries-review-final | Final checkpoint pass | [record](boundaries-review-final-receipt.json) |
| clippy-final | Earlier pass; superseded source | [record](clippy-final-receipt.json) |
| clippy-review-final | Final checkpoint pass | [record](clippy-review-final-receipt.json) |
| fmt-final | Earlier pass; superseded source | [record](fmt-final-receipt.json) |
| fmt-review-final | Final checkpoint pass | [record](fmt-review-final-receipt.json) |
| gateway-final | Earlier pass; superseded source | [record](gateway-final-receipt.json) |
| gateway-review-final | Final checkpoint pass | [record](gateway-review-final-receipt.json) |
| new-regressions-first | Failed fixture; retained and repaired | [record](new-regressions-first-receipt.json) |
| new-regressions-scheduler-repair | Earlier pass; superseded source | [record](new-regressions-scheduler-repair-receipt.json) |
| old-order-negative | Earlier partial negative: request/approval detect defect; lease fixture fails preparation | [record](old-order-negative-receipt.json) |
| old-order-negative-runway-repair | Earlier expected negative: all three fail; superseded test proof | [record](old-order-negative-runway-repair-receipt.json) |
| old-order-review-final | Expected negative control: all three expiry cases fail against baseline production | [record](old-order-review-final-receipt.json) |
| operations-final | Earlier pass; superseded source | [record](operations-final-receipt.json) |
| operations-review-final | Final checkpoint pass | [record](operations-review-final-receipt.json) |
| source-fence-negative | Expected negative: source expiry escapes when only validation order is repaired | [record](source-fence-negative-receipt.json) |

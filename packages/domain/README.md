# @platform/domain

The guest-and-shift domain: money, tax, order totals, sizes, fulfillment,
loyalty rules, the drop lineup, search, navigation vocabulary, and the row
types every surface shares.

Framework-free by design — no React, no react-native, no Expo, and no asset
imports — so `node:test` reaches all of it directly and any of the five
surfaces can import it.

It exists because `apps/customer` and `apps/operator` are forks of one
ancestor and carried ~150 byte-identical files between them. Editing one copy
was how they drifted; `tests/consistency` caught that, and promoting a module
here is the fix that guard asks for.

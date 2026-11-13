# Veyra mock lending adapter

This testnet-only contract implements the subset of the Burrow interaction surface used by Veyra:

- supply through NEP-141 `ft_transfer_call` with an empty message;
- withdraw through `execute` with a `Withdraw { token_id, max_amount }` action;
- configurable basis-point rewards paid from a prefunded token reserve.

It makes stablecoin deployment and yield reconciliation deterministic during a demo. It is not a lending market and must not be presented or deployed as one.

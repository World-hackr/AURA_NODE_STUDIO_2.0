# Circuit IR

This package will hold the canonical circuit data model.

Two layers are expected:

1. `circuit_intent`
   AI-facing, smaller, goal-oriented
2. `circuit_ir`
   canonical, deterministic, compiler-ready

The browser UI and export system must both converge on `circuit_ir`.

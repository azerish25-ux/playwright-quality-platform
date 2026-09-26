# History and reliability

For eligible logical executions, `N` is the completed population expected to pass, `F` is initial failure followed by retry pass, `I` is initial failure, and `P` is persistent final failure. ForgeQA reports `F/N`, `I/N`, `P/N`, and `F/I` with numerator, denominator, and a minimum-sample state. Missing history is `null`/insufficient data. Trusted default-branch history is separated from untrusted PR, synthetic, and diagnostic observations.

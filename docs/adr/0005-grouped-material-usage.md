# Keep usage entries as immutable groups of stock movements

Site Personnel needs to record several materials together while retaining the existing stock ledger and historical attribution. A usage entry groups immutable movements and is saved atomically with a stable retry ID, rather than maintaining a second balance or applying independent per-material saves that could partially succeed. Historical corrections remain separate stock adjustments; older movements are not retroactively grouped or assigned to scopes.

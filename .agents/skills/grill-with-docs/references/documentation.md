# Documentation During Grilling

Read the repository's agent instructions and maintained context documents before recording terminology or decisions. Use its existing document locations and documentation scope. In this project, product terminology belongs in the project overview, architecture decisions in architecture context, and progress and verification in the progress tracker. Additional companion documents require an agreed scope under the AI workflow rules.

## Sharpen the domain model

- Challenge terms that conflict with the existing glossary or maintained product language. Explain the conflict and ask which meaning is intended.
- Propose precise canonical terms when language is vague or overloaded.
- Stress-test relationships with concrete edge cases to clarify boundaries between concepts.
- Compare claims with the code. Surface contradictions rather than silently choosing one account.
- Record resolved terms as they crystallise in the permitted documentation. Keep glossary entries focused on domain meaning, separate from implementation details.

For repositories that permit standalone glossaries, use [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md). Follow an existing context map when present; otherwise use the existing single context. Create a glossary lazily only when a term is resolved and the repository permits that location.

## Record consequential decisions

Offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Otherwise update the relevant maintained documentation directly when needed.

Use [ADR-FORMAT.md](ADR-FORMAT.md) when a separate ADR is appropriate and permitted. Capture the context, decision and reason, including rejected alternatives only when their rejection would otherwise be unclear. Create files only when there is an agreed decision to record. Preserve unresolved questions as unresolved.

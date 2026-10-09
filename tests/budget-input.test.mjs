import test from "node:test";
import assert from "node:assert/strict";
import { budgetInputEdit, formatBudgetInput, parseBudgetInput } from "../src/domain/budget-input.ts";

test("budget grouping preserves empty values, cents and decimal entry", () => {
  for (const [raw, display] of [["", ""], ["100", "100"], ["1000", "1,000"], ["1234567.50", "1,234,567.50"], ["1000.", "1,000."], ["0.05", "0.05"]]) assert.equal(formatBudgetInput(raw), display);
  assert.equal(parseBudgetInput("1,234,567.50"), 1234567.5);
});

test("pasted budgets normalize zeros and keep the cursor near the edited digit", () => {
  assert.deepEqual(budgetInputEdit("1,234,567.89", 12), { raw: "1234567.89", display: "1,234,567.89", caret: 12 });
  assert.deepEqual(budgetInputEdit("120,345", 2), { raw: "120345", display: "120,345", caret: 2 });
  assert.deepEqual(budgetInputEdit("0001500", 7), { raw: "1500", display: "1,500", caret: 5 });
  assert.deepEqual(budgetInputEdit(".5", 2), { raw: "0.5", display: "0.5", caret: 3 });
  for (const invalid of ["-1000", "1e6", "100.555", "1.2.3", "PHP 1,000"]) assert.equal(budgetInputEdit(invalid, invalid.length), undefined);
});

# The Ledger — Feature Roadmap

The complete implementation plan for The Ledger small-business bookkeeping
app. **All 9 phases and 47 tasks below are implemented and validated** — the
app is feature-complete.

- The working mirror of this roadmap is the `features` checklist in
  `main.pjs`, which also drives the in-app "Roadmap" view.
- Status values in `main.pjs`: `pending` | `done` (all are `done`).
- Module keys ↔ phases: `ledger`(1) · `ap`(2) · `ar`(3) · `tax`(4) · `ocr`(5) ·
  `payroll`(6) · `reports`(7) · `inventory`(8) · `projects`(9).

---

### Phase 1: General Ledger & Chart of Accounts
1. **[x] Define Chart of Accounts (CoA) Structure:** Implement a hierarchical system to create, edit, and categorize accounts (Assets, Liabilities, Equity, Revenue, Expenses) with unique account codes and parent-child relationships.
2. **[x] Create Double-Entry Journal Entry System:** Implement a mechanism to record transactions where total debits equal total credits, ensuring every transaction is balanced before commit.
3. **[x] Implement Transaction Posting Logic:** Create a system that automatically updates the real-time balance of CoA accounts based on posted journal entries.
4. **[x] Develop Period Closing Mechanism:** Implement a function to lock transactions for a specific date range (Month/Quarter/Year) and carry forward net income to retained earnings.
5. **[x] Implement Ledger Audit Trail:** Create an immutable log that tracks every change to a journal entry, including timestamp, user ID, and previous/new values.
6. **[x] Generate Trial Balance Report:** Create a reporting function that aggregates all account balances to verify that total debits equal total credits at a specific point in time.

### Phase 2: Accounts Payable
7. **[x] Manage Purchase Orders (PO):** Implement a workflow to create POs with vendor details and line-item descriptions that can be transitioned into bills.
8. **[x] Process Vendor Bill Entry:** Implement a system to receive vendor bills, matching line items to existing POs or creating new expense entries.
9. **[x] Implement Recurring Expense Automation:** Create a scheduler to automatically generate draft bills for fixed monthly expenses on a specified date.
10. **[x] Develop Line-Item Matching Engine:** Create a validation tool that flags discrepancies between PO quantities/prices and the final vendor bill.
11. **[x] Manage Payment Disbursement (ACH/Check):** Implement a payment trigger that marks bills as "Paid," generates a payment reference, and creates the corresponding credit entry in the ledger.
12. **[x] Track A/P Aging:** Create a report that categorizes unpaid vendor bills by the number of days past the due date (0-30, 31-60, 61-90, 90+).

### Phase 3: Accounts Receivable
13. **[x] Create Customizable Invoicing Engine:** Implement a tool to generate professional invoices with customizable templates, tax calculations, and unique invoice numbering.
14. **[x] Implement Quote-to-Invoice Workflow:** Create a mechanism to convert an approved customer estimate/quote into a live invoice with a single action.
15. **[x] Automate Recurring Billing:** Implement a system to generate and send invoices to customers on a predefined cadence (weekly, monthly, annually).
16. **[x] Integrate Payment Gateway Processing:** Implement a handler to accept credit card and bank transfer payments, automatically marking invoices as "Paid" upon successful webhook confirmation.
17. **[x] Develop Payment Reminder System:** Create a trigger-based notification system that sends automated emails to customers for invoices approaching or exceeding their due date.
18. **[x] Track A/R Aging:** Create a report that categorizes outstanding customer invoices by the number of days past the due date to identify overdue revenue.

### Phase 4: Multi-Currency & Tax Engine
19. **[x] Base Currency Definition:** Establish a global system base currency; ensure all financial totals are stored in base currency while maintaining the original transaction currency and exchange rate used at the time of entry.
20. **[x] Exchange Rate Integration:** Implement a mechanism to fetch and update currency exchange rates; allow for manual overrides per transaction to handle specific negotiated rates.
21. **[x] Dynamic Tax Calculation:** Calculate applicable taxes (GST/HST/PST/VAT/US Sales Tax) based on the transaction's jurisdictional origin and destination, applying the correct percentage to the subtotal.
22. **[x] Tax Liability Routing:** Automatically route the calculated tax amount from a transaction into a designated "Tax Payable" liability account in the ledger.
23. **[x] Tax Preparation Report:** Generate a summary report aggregating all tax collected and paid over a specific date range, categorized by tax type and jurisdiction.

### Phase 5: OCR Receipt & Document Capture
24. **[x] Document Ingestion Pipeline:** Create an entry point for uploading image/PDF files via camera or email, storing the raw file and assigning a unique tracking ID.
25. **[x] Data Extraction Engine:** Extract the transaction date, vendor name, total amount, currency, and individual line items from the ingested document.
26. **[x] CoA Auto-Suggestion:** Analyze extracted vendor and line-item text to suggest the most likely Chart of Accounts (CoA) expense category based on historical data and keywords.
27. **[x] Human-in-the-Loop Review:** Provide a side-by-side interface displaying the raw document and the extracted fields for user verification and correction before final submission.
28. **[x] Ledger Commitment:** Commit the verified OCR data into the ledger as a pending transaction, linking the original document file to the ledger entry for audit purposes.

### Phase 6: Simple Payroll & Workforce Management
29. **[x] Employee Profile Management:** Create and store employee records containing full name, unique employee ID, hourly/salary pay rate, and specific tax withholding percentages.
30. **[x] Timesheet Entry & Submission:** Implement a mechanism for recording hours worked per employee per pay period, requiring a submission state and a subsequent approval state by a manager.
31. **[x] Payroll Calculation Engine:** Calculate gross pay based on approved hours and rates, subtract statutory withholdings based on employee settings, and determine final net pay.
32. **[x] Payslip Generation:** Generate a read-only document for each employee detailing gross pay, individual deductions, net pay, and the pay period dates.
33. **[x] Payroll Ledger Integration:** Automatically create a journal entry that debits the payroll expense account and credits the cash account for the total net pay, while crediting liability accounts for withholdings.

### Phase 7: Financial Reporting & Analytics
34. **[x] Profit & Loss Statement:** Generate a report that aggregates all revenue and expense accounts for a selected date range to calculate net income.
35. **[x] Balance Sheet Generation:** Produce a point-in-time report showing the sum of all asset, liability, and equity accounts, ensuring the fundamental accounting equation remains balanced.
36. **[x] Cash Flow Statement:** Track and report the movement of cash across operating, investing, and financing activities for a specified period.
37. **[x] A/R and A/P Aging Reports:** List all unpaid invoices (Accounts Receivable) and unpaid bills (Accounts Payable), categorized by the number of days elapsed since the due date.
38. **[x] Financial KPI Dashboard:** Display real-time summaries of total revenue, total expenses, current cash position, and the total balance of receivables versus payables.
39. **[x] Profit Margin Analysis:** Calculate and display the percentage difference between total revenue and the cost of goods sold/operating expenses for a given period.

### Phase 8: Inventory & COGS
40. **[x] Item Catalog Management:** Create a system to define trackable items with attributes for SKU, description, unit of measure, and current quantity on hand.
41. **[x] Inventory Transaction Logic:** Automate quantity adjustments where "Purchase" transactions increase stock and "Sales/Invoice" transactions decrease stock.
42. **[x] COGS Calculation Engine:** Implement a mechanism to calculate the Cost of Goods Sold (COGS) based on the unit cost of items sold during a specific period.
43. **[x] Inventory Valuation Report:** Generate a report calculating the total monetary value of current on-hand inventory based on the most recent purchase price or weighted average cost.

### Phase 9: Project & Job Costing
44. **[x] Project Attribution System:** Enable the tagging of any expense, purchase, or invoice to a specific project ID or client entity.
45. **[x] Project Revenue Tracking:** Aggregate all income associated with a specific project ID to determine gross project revenue.
46. **[x] Project Expense Aggregation:** Aggregate all direct costs and labor associated with a specific project ID to determine total project expenditure.
47. **[x] Project Margin Analysis:** Compute the net profit and margin percentage per project by subtracting aggregated expenses from aggregated revenue.

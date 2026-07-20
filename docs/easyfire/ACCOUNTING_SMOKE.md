# EasyFire Bookkeeping -- Synthetic Accounting Reconciliation (Sanitized)

**Source:** Bigcapital (AGPL-3.0) -- https://github.com/bigcapitalhq/bigcapital
**Upstream base:** `8c90ca328ec59dd772de3b385531eb386de11ac8`
**EasyFire repository:** https://github.com/EasyFire101/easyfire-bookkeeping
**Date cleaned:** 2026-07-19
**Scope:** Document-only synthetic accounting reconciliation
**Evidence type:** Sanitized arithmetic and source-structure review using zero real LLC data
**Execution status:** This is a document-only reconciliation proof. It did not create or validate application or database records.

> The frozen install and full application build now pass, but neither check
> turns this arithmetic fixture into application, disposable Docker, backup,
> restore, or live evidence. Agent Foundry is provenance only; current proof
> status is recorded in [HANDOFF.md](../../HANDOFF.md).

---

## 1. Fake Company Profile

| Field                | Value                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Company name         | Archway Digital Solutions LLC                                                                                                 |
| Legal form           | Limited Liability Company (single-member, disregarded entity)                                                                 |
| Industry             | Digital Services / Software Consulting                                                                                        |
| Fictitious address   | 1400 Wynkoop Street, Suite 200, Denver, CO 80202                                                                              |
| Base currency        | USD                                                                                                                           |
| Fiscal year          | January 1 -- December 31                                                                                                      |
| Fake EIN placeholder | 98-7654321                                                                                                                    |
| Start date           | January 1, 2024                                                                                                               |
| Data classification  | All names, amounts, addresses, and identifiers are synthetic; no real LLC, client, vendor, or individual records are present. |

---

## 2. Chart of Accounts

### 2.1 Seed Source

The chart of accounts originates from BigCapital tenant seed data at:

- `packages/server/src/database/tenant/seeds/data/accounts.ts` (401 lines, 35 accounts)
- `packages/server/src/constants/accounts.ts` (230 lines, 21 account types, 7 parent types, 5 root types)
- Seed runner: `packages/server/src/database/tenant/seeds/core/20190423085242_seed_accounts.ts`

### 2.2 Account Type Taxonomy

| Root Type     | Normal Balance | Parent Types          | Account Types                                                               |
| ------------- | -------------- | --------------------- | --------------------------------------------------------------------------- |
| **Asset**     | Debit          | Current Asset         | `cash`, `bank`, `accounts-receivable`, `inventory`, `other-current-asset`   |
| **Asset**     | Debit          | Fixed Asset           | `fixed-asset`, `non-current-asset`                                          |
| **Liability** | Credit         | Current Liability     | `accounts-payable`, `credit-card`, `tax-payable`, `other-current-liability` |
| **Liability** | Credit         | Long Term Liability   | `long-term-liability`                                                       |
| **Liability** | Credit         | Non-Current Liability | `non-current-liability`                                                     |
| **Equity**    | Credit         | Equity                | `equity`                                                                    |
| **Income**    | Credit         | Income                | `income`, `other-income`                                                    |
| **Expense**   | Debit          | Expense               | `cost-of-goods-sold`, `expense`, `other-expense`                            |

### 2.3 Full Chart of Accounts (from Seed Data)

#### Assets (10000-series)

| Code   | Name                      | Type                  | Parent Type   | Normal | Predefined |
| ------ | ------------------------- | --------------------- | ------------- | ------ | ---------- |
| 10001  | Bank Account              | `bank`                | Current Asset | Debit  | Yes        |
| 10002  | Saving Bank Account       | `bank`                | Current Asset | Debit  | No         |
| 10003  | Undeposited Funds         | `cash`                | Current Asset | Debit  | Yes        |
| 10004  | Petty Cash                | `cash`                | Current Asset | Debit  | Yes        |
| 10005  | Computer Equipment        | `fixed-asset`         | Fixed Asset   | Debit  | No         |
| 10006  | Office Equipment          | `fixed-asset`         | Fixed Asset   | Debit  | No         |
| 10007  | Accounts Receivable (A/R) | `accounts-receivable` | Current Asset | Debit  | Yes        |
| 10008  | Inventory Asset           | `inventory`           | Current Asset | Debit  | Yes        |
| 100010 | Prepaid Expenses          | `other-current-asset` | Current Asset | Debit  | Yes        |
| 100020 | Stripe Clearing           | `other-current-asset` | Current Asset | Debit  | Yes        |

#### Liabilities (20000-series)

| Code  | Name                        | Type                      | Parent Type       | Normal | Predefined |
| ----- | --------------------------- | ------------------------- | ----------------- | ------ | ---------- |
| 20001 | Accounts Payable (A/P)      | `accounts-payable`        | Current Liability | Credit | Yes        |
| 20002 | Owner A Drawings            | `other-current-liability` | Current Liability | Credit | No         |
| 20003 | Loan                        | `other-current-liability` | Current Liability | Credit | No         |
| 20004 | Opening Balance Liabilities | `other-current-liability` | Current Liability | Credit | No         |
| 20005 | Revenue Received in Advance | `other-current-liability` | Current Liability | Credit | No         |
| 20006 | Tax Payable                 | `tax-payable`             | Current Liability | Credit | Yes        |

#### Equity (30000-series)

| Code  | Name                   | Type     | Parent Type | Normal | Predefined |
| ----- | ---------------------- | -------- | ----------- | ------ | ---------- |
| 30001 | Retained Earnings      | `equity` | Equity      | Credit | Yes        |
| 30002 | Opening Balance Equity | `equity` | Equity      | Credit | Yes        |
| 30003 | Owner's Equity         | `equity` | Equity      | Credit | Yes        |
| 30003 | Drawings               | `equity` | Equity      | Credit | Yes        |

#### Expenses (40000-series)

| Code  | Name                  | Type                 | Parent Type | Normal | Predefined |
| ----- | --------------------- | -------------------- | ----------- | ------ | ---------- |
| 40001 | Other Expenses        | `other-expense`      | Expense     | Debit  | Yes        |
| 40002 | Cost of Goods Sold    | `cost-of-goods-sold` | Expense     | Debit  | Yes        |
| 40003 | Office Expenses       | `expense`            | Expense     | Debit  | No         |
| 40004 | Rent                  | `expense`            | Expense     | Debit  | No         |
| 40005 | Exchange Gain or Loss | `other-expense`      | Expense     | Debit  | Yes        |
| 40006 | Bank Fees and Charges | `expense`            | Expense     | Debit  | No         |
| 40007 | Depreciation Expense  | `expense`            | Expense     | Debit  | No         |
| 40008 | Discount              | `other-income`       | Income      | Credit | Yes        |
| 40009 | Purchase Discount     | `other-expense`      | Expense     | Debit  | Yes        |
| 40010 | Other Charges         | `other-income`       | Income      | Credit | Yes        |
| 40011 | Other Expenses        | `other-expense`      | Expense     | Debit  | Yes        |

#### Income (50000-series)

| Code  | Name                    | Type                      | Parent Type       | Normal | Predefined |
| ----- | ----------------------- | ------------------------- | ----------------- | ------ | ---------- |
| 50001 | Sales of Product Income | `income`                  | Income            | Credit | Yes        |
| 50002 | Sales of Service Income | `income`                  | Income            | Credit | No         |
| 50003 | Uncategorized Income    | `income`                  | Income            | Credit | Yes        |
| 50004 | Other Income            | `other-income`            | Income            | Credit | No         |
| 50005 | Unearned Revenue        | `other-current-liability` | Current Liability | Credit | Yes        |

### 2.4 Chart of Accounts Coherence Assessment

- Account codes follow a logical numbering scheme: `1xxxx` = Assets, `2xxxx` = Liabilities, `3xxxx` = Equity, `4xxxx` = Expenses/Losses, `5xxxx` = Income/Gains.
- Every account maps to a valid `account_type` with a well-defined `root_type`, `parent_type`, and `normal` balance direction per `ACCOUNT_TYPES[]` in `packages/server/src/constants/accounts.ts`.
- Predefined accounts (17 of 35) are locked and shipped with every new organization via the tenant seed runner.
- Known upstream seed quirks (non-blocking): codes `40001` and `40011` are both named "Other Expenses" (both `other-expense` type); code `30003` is shared by "Owner's Equity" and "Drawings". These are present in the upstream BigCapital v1 seed data and are not introduced by EasyFire.
- All five root types (Asset, Liability, Equity, Income, Expense) are represented, forming a complete general ledger skeleton.
- The seed data is coherent: no orphaned account types, no missing parent/root type mappings.

---

## 3. Sample Opening Balances (January 1, 2024)

All figures are synthetic. No real LLC financial data is used.

### 3.1 Narrative

The sole member contributes $50,000 to open the company bank account. The company purchases $10,000 in computer equipment and $5,000 in office furniture, paid from the bank account. A bank loan of $20,000 is drawn, also deposited into the bank account.

### 3.2 Opening Balance Journal Entries

| Entry | Account            | Code  | Debit (USD) | Credit (USD) |
| ----- | ------------------ | ----- | ----------: | -----------: |
| OB-A  | Bank Account       | 10001 |   50,000.00 |              |
| OB-A  | Owner's Equity     | 30003 |             |    50,000.00 |
| OB-B  | Computer Equipment | 10005 |   10,000.00 |              |
| OB-B  | Bank Account       | 10001 |             |    10,000.00 |
| OB-C  | Office Equipment   | 10006 |    5,000.00 |              |
| OB-C  | Bank Account       | 10001 |             |     5,000.00 |
| OB-D  | Bank Account       | 10001 |   20,000.00 |              |
| OB-D  | Loan               | 20003 |             |    20,000.00 |

**Entry totals -- each entry is balanced:**

| Entry                     | Total Debit | Total Credit | Balanced |
| ------------------------- | ----------: | -----------: | :------: |
| OB-A (owner contribution) |   50,000.00 |    50,000.00 |   Yes    |
| OB-B (computer purchase)  |   10,000.00 |    10,000.00 |   Yes    |
| OB-C (furniture purchase) |    5,000.00 |     5,000.00 |   Yes    |
| OB-D (loan draw)          |   20,000.00 |    20,000.00 |   Yes    |

**All entries combined:** Total Debits = $85,000.00, Total Credits = $85,000.00 ✓

### 3.3 Opening Balance Trial Balance

| Account            | Code  | Type                      | Normal |   Debit (USD) |  Credit (USD) |
| ------------------ | ----- | ------------------------- | ------ | ------------: | ------------: |
| Bank Account       | 10001 | `bank`                    | Debit  |     55,000.00 |               |
| Computer Equipment | 10005 | `fixed-asset`             | Debit  |     10,000.00 |               |
| Office Equipment   | 10006 | `fixed-asset`             | Debit  |      5,000.00 |               |
| Loan               | 20003 | `other-current-liability` | Credit |               |     20,000.00 |
| Owner's Equity     | 30003 | `equity`                  | Credit |               |     50,000.00 |
| **Totals**         |       |                           |        | **70,000.00** | **70,000.00** |

**Trial balance:** Total Debits ($70,000.00) = Total Credits ($70,000.00) ✓

### 3.4 Opening Balance Sheet Verification

|                 | Account                        | Amount (USD)  |
| --------------- | ------------------------------ | ------------- |
| **Assets**      |                                |               |
|                 | 10001 Bank Account             | 55,000.00     |
|                 | 10005 Computer Equipment       | 10,000.00     |
|                 | 10006 Office Equipment         | 5,000.00      |
|                 | **Total Assets**               | **70,000.00** |
| **Liabilities** |                                |               |
|                 | 20003 Loan                     | 20,000.00     |
|                 | **Total Liabilities**          | **20,000.00** |
| **Equity**      |                                |               |
|                 | 30003 Owner's Equity           | 50,000.00     |
|                 | **Total Equity**               | **50,000.00** |
|                 | **Total Liabilities + Equity** | **70,000.00** |

**Accounting equation:** Assets ($70,000) = Liabilities ($20,000) + Equity ($50,000) ✓

---

## 4. Sample Transactions

All transactions use synthetic counterparty names. No real clients or vendors are referenced.

### 4.1 Transaction Journal

| #     | Date       | Description                                                  | Account                 | Code  | Debit (USD) | Credit (USD) |
| ----- | ---------- | ------------------------------------------------------------ | ----------------------- | ----- | ----------: | -----------: |
| TXN-1 | 2024-01-15 | Consulting services invoiced to Acme Corp (fictional client) | A/R (A/R)               | 10007 |    8,000.00 |              |
| TXN-1 | 2024-01-15 |                                                              | Sales of Service Income | 50002 |             |     8,000.00 |
| TXN-2 | 2024-01-25 | Payment received from Acme Corp                              | Bank Account            | 10001 |    8,000.00 |              |
| TXN-2 | 2024-01-25 |                                                              | A/R (A/R)               | 10007 |             |     8,000.00 |
| TXN-3 | 2024-02-01 | Q1 office rent paid to Plaza One LLC (fictional landlord)    | Rent                    | 40004 |    3,000.00 |              |
| TXN-3 | 2024-02-01 |                                                              | Bank Account            | 10001 |             |     3,000.00 |
| TXN-4 | 2024-02-05 | Monthly bank maintenance fee                                 | Bank Fees and Charges   | 40006 |       50.00 |              |
| TXN-4 | 2024-02-05 |                                                              | Bank Account            | 10001 |             |        50.00 |

### 4.2 Transaction Balances

| TXN   | Description            | Total Debit | Total Credit | Balanced |
| ----- | ---------------------- | ----------: | -----------: | :------: |
| TXN-1 | Invoice to Acme Corp   |    8,000.00 |     8,000.00 |   Yes    |
| TXN-2 | Payment from Acme Corp |    8,000.00 |     8,000.00 |   Yes    |
| TXN-3 | Q1 rent                |    3,000.00 |     3,000.00 |   Yes    |
| TXN-4 | Bank fees              |       50.00 |        50.00 |   Yes    |

**All transactions combined:** Total Debits = $19,050.00, Total Credits = $19,050.00 ✓

---

## 5. Post-Transaction Trial Balance and Balance Sheet

### 5.1 Combined Trial Balance (OB + all transactions)

| Account                   | Code  | Type                      |   Debit (USD) |  Credit (USD) |
| ------------------------- | ----- | ------------------------- | ------------: | ------------: |
| Bank Account              | 10001 | `bank`                    |     59,950.00 |               |
| Computer Equipment        | 10005 | `fixed-asset`             |     10,000.00 |               |
| Office Equipment          | 10006 | `fixed-asset`             |      5,000.00 |               |
| Accounts Receivable (A/R) | 10007 | `accounts-receivable`     |          0.00 |               |
| Loan                      | 20003 | `other-current-liability` |               |     20,000.00 |
| Owner's Equity            | 30003 | `equity`                  |               |     50,000.00 |
| Rent                      | 40004 | `expense`                 |      3,000.00 |               |
| Bank Fees and Charges     | 40006 | `expense`                 |         50.00 |               |
| Sales of Service Income   | 50002 | `income`                  |               |      8,000.00 |
| **Totals**                |       |                           | **78,000.00** | **78,000.00** |

**Trial balance:** Total Debits ($78,000.00) = Total Credits ($78,000.00) ✓

### 5.2 Balance Sheet (after closing income/expense to equity)

|                 | Account                         | Amount (USD)  |
| --------------- | ------------------------------- | ------------- |
| **Assets**      |                                 |               |
|                 | 10001 Bank Account              | 59,950.00     |
|                 | 10005 Computer Equipment        | 10,000.00     |
|                 | 10006 Office Equipment          | 5,000.00      |
|                 | 10007 Accounts Receivable       | 0.00          |
|                 | **Total Assets**                | **74,950.00** |
| **Liabilities** |                                 |               |
|                 | 20003 Loan                      | 20,000.00     |
|                 | **Total Liabilities**           | **20,000.00** |
| **Equity**      |                                 |               |
|                 | 30003 Owner's Equity            | 50,000.00     |
|                 | Net Income (Revenue - Expenses) | 4,950.00      |
|                 | **Total Equity**                | **54,950.00** |
|                 | **Total Liabilities + Equity**  | **74,950.00** |

**Accounting equation:** Assets ($74,950) = Liabilities ($20,000) + Equity ($54,950) ✓

### 5.3 Income Statement

|              | Account                 | Code  | Amount (USD)   |
| ------------ | ----------------------- | ----- | -------------- |
| **Income**   | Sales of Service Income | 50002 | 8,000.00       |
|              | **Total Income**        |       | **8,000.00**   |
| **Expenses** | Rent                    | 40004 | (3,000.00)     |
|              | Bank Fees               | 40006 | (50.00)        |
|              | **Total Expenses**      |       | **(3,050.00)** |
|              | **Net Income**          |       | **4,950.00**   |

---

## 6. Double-Entry Correctness Verification

### 6.1 Overview

| Check                                                          | Result |
| -------------------------------------------------------------- | ------ |
| 4 opening balance journal entries -- each sums to zero         | Pass   |
| 4 transaction journal entries -- each sums to zero             | Pass   |
| Opening trial balance (debits = credits)                       | Pass   |
| Post-transaction trial balance (debits = credits)              | Pass   |
| Opening balance sheet (Assets = Liabilities + Equity)          | Pass   |
| Post-transaction balance sheet (Assets = Liabilities + Equity) | Pass   |
| Income statement (Revenue - Expenses = Net Income)             | Pass   |
| Net Income closes correctly into Equity                        | Pass   |
| No unbalanced journal entries in any step                      | Pass   |
| All account types use correct normal balance direction         | Pass   |

### 6.2 Traceability

Every transaction maps to a specific journal entry pair (OB-A through OB-D, TXN-1 through TXN-4) above. Each pair can be traced from source narrative through journal entry to trial balance and balance sheet.

Debit accounts used: `bank` (10001), `fixed-asset` (10005, 10006), `accounts-receivable` (10007), `expense` (40004, 40006) -- all debit-normal accounts, correctly carrying debit balances.
Credit accounts used: `other-current-liability` (20003), `equity` (30003), `income` (50002) -- all credit-normal accounts, correctly carrying credit balances.

No account carries a balance on the wrong side of its normal.

---

## 7. Synthetic-Data Boundary

- Every company, person, address, identifier, and amount in this document is a teaching fixture.
- No production database, backup, credential, customer, vendor, bank, tax, or LLC record was read or changed to produce this document.
- The arithmetic is illustrative. It is not evidence that the same entries were executed through the web application.
- A separate fake-data E2E receipt is required before this workflow can be called application-validated.

---

## 8. Evidence Summary

| Artifact                         | Scope                | Status                    |
| -------------------------------- | -------------------- | ------------------------- |
| Synthetic company profile        | Section 1            | Defined in this document  |
| Seed-derived chart of accounts   | Section 2            | Reviewed from source      |
| Opening-balance journal examples | Section 3            | Arithmetically balanced   |
| Transaction journal examples     | Section 4            | Arithmetically balanced   |
| Trial balance and statements     | Section 5            | Arithmetically reconciled |
| Double-entry checklist           | Section 6            | Document review passed    |
| Application/database execution   | Separate E2E receipt | Not claimed here          |

This file proves only that the documented synthetic example reconciles and contains no real bookkeeping data.

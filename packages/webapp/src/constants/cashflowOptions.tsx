// @ts-nocheck
import intl from 'react-intl-universal';

export const getAddMoneyInOptions = () => [
  {
    name: intl.get('banking.owner_contribution'),
    value: 'owner_contribution',
  },
  {
    name: intl.get('banking.other_income'),
    value: 'other_income',
  },
  {
    name: intl.get('banking.transfer_form_account'),
    value: 'transfer_from_account',
  },
];

export const getAddMoneyOutOptions = () => [
  {
    name: intl.get('banking.owner_drawings'),
    value: 'owner_drawing',
  },
  {
    name: intl.get('banking.expenses'),
    value: 'other_expense',
  },
  {
    name: intl.get('banking.transfer_to_account'),
    value: 'transfer_to_account',
  },
];

export const TRANSACTIONS_TYPE = [
  'OwnerContribution',
  'OtherIncome',
  'TransferFromAccount',
  'OwnerDrawing',
  'OtherExpense',
  'TransferToAccount',
];

export const MoneyCategoryPerCreditAccountRootType = {
  OwnerContribution: ['equity'],
  OtherIncome: ['income'],
  OwnerDrawing: ['equity'],
  OtherExpense: ['expense'],
  TransferToAccount: ['asset'],
  TransferFromAccount: ['asset'],
};

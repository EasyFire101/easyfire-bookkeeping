import React from 'react';
import { Position } from '@blueprintjs/core';
import {
  AccountsSelect,
  FDateInput,
  FFormGroup,
  FInputGroup,
  FTextArea,
  Icon,
} from '@/components';
import { useCategorizeTransactionBoot } from '../CategorizeTransactionBoot';
import { CategorizeTransactionBranchField } from '../CategorizeTransactionBranchField';

export function CategorizeTransactionOwnerContribution() {
  const { accounts } = useCategorizeTransactionBoot();

  return (
    <>
      <FFormGroup name={'date'} label={'Date'} fastField inline>
        <FDateInput
          name={'date'}
          popoverProps={{ position: Position.BOTTOM, minimal: true }}
          formatDate={(date: Date) => date.toLocaleDateString()}
          parseDate={(str: string) => new Date(str)}
          inputProps={{ fill: true, leftElement: <Icon icon={'date-range'} /> }}
        />
      </FFormGroup>

      <FFormGroup
        name={'debitAccountId'}
        label={'From Account'}
        fastField
        inline
      >
        <AccountsSelect
          name={'debitAccountId'}
          // @ts-expect-error AccountsSelect expects AccountSelectModel[]; boot
          // provides raw Account[] — runtime tolerates.
          items={accounts}
          fastField
          fill
          allowCreate
          disabled
        />
      </FFormGroup>

      <FFormGroup
        name={'creditAccountId'}
        label={'Equity Account'}
        fastField
        inline
      >
        <AccountsSelect
          name={'creditAccountId'}
          // @ts-expect-error AccountsSelect expects AccountSelectModel[]; boot
          // provides raw Account[] — runtime tolerates.
          items={accounts}
          filterByRootTypes={['equity']}
          fastField
          fill
          allowCreate
        />
      </FFormGroup>

      <FFormGroup name={'referenceNo'} label={'Reference No.'} fastField inline>
        <FInputGroup name={'referenceNo'} fill />
      </FFormGroup>

      <FFormGroup name={'description'} label={'Description'} fastField inline>
        <FTextArea name={'description'} growVertically large fill />
      </FFormGroup>

      <CategorizeTransactionBranchField />
    </>
  );
}

import React from 'react';
import { FSelect } from '@/components/Forms';
import type { AccountTypesList } from '@bigcapital/sdk-ts';

type FSelectProps = React.ComponentProps<typeof FSelect>;
type AccountType = AccountTypesList[number];

interface AccountsTypesSelectProps extends Omit<FSelectProps, 'items'> {
  items: AccountTypesList;
}

export function AccountsTypesSelect({
  ...props
}: AccountsTypesSelectProps): React.ReactElement {
  return (
    <FSelect<AccountType>
      valueAccessor={'key'}
      labelAccessor={'label'}
      textAccessor={'label'}
      placeholder={'Select an account...'}
      {...props}
    />
  );
}

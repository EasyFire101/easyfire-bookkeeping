// @ts-nocheck
import React from 'react';
import {
  AccountsSelect,
  FFormGroup,
  FormattedMessage as T,
  Box,
} from '@/components';

import { withCurrentOrganization } from '@/containers/Organization/withCurrentOrganization';
import { accountsFieldShouldUpdate } from './utils';
import { ACCOUNT_TYPE } from '@/constants/accountTypes';
import { useItemFormContext } from './ItemFormProvider';
import { compose } from '@/utils';
import { ItemFormSectionTitle } from './ItemFormSectionTitle';

function ItemFormInventorySectionBase() {
  const { accounts } = useItemFormContext();

  return (
    <Box data-section-id="inventory">
      <ItemFormSectionTitle>Inventory details</ItemFormSectionTitle>

      {/*------------- Inventory Account ------------- */}
      <FFormGroup
        label={<T id={'inventory_account'} />}
        name={'inventory_account_id'}
        items={accounts}
        fastField={true}
        shouldUpdate={accountsFieldShouldUpdate}
        inline={true}
        fill
      >
        <AccountsSelect
          name={'inventory_account_id'}
          items={accounts}
          placeholder={<T id={'select_account'} />}
          filterByTypes={[ACCOUNT_TYPE.INVENTORY]}
          fastField={true}
          shouldUpdate={accountsFieldShouldUpdate}
        />
      </FFormGroup>
    </Box>
  );
}

export const ItemFormInventorySection = compose(withCurrentOrganization())(
  ItemFormInventorySectionBase,
);

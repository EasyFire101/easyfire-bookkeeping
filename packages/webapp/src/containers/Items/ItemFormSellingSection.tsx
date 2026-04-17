// @ts-nocheck
import React from 'react';
import { useFormikContext, FastField } from 'formik';
import { FormGroup, Checkbox, ControlGroup } from '@blueprintjs/core';
import {
  AccountsSelect,
  FMoneyInputGroup,
  Hint,
  InputPrependText,
  FFormGroup,
  FTextArea,
  Box,
} from '@/components';
import { FormattedMessage as T } from '@/components';

import { useItemFormContext } from './ItemFormProvider';
import { withCurrentOrganization } from '@/containers/Organization/withCurrentOrganization';
import { ACCOUNT_PARENT_TYPE } from '@/constants/accountTypes';
import {
  sellDescriptionFieldShouldUpdate,
  sellAccountFieldShouldUpdate,
  sellPriceFieldShouldUpdate,
} from './utils';
import { compose } from '@/utils';
import { TaxRatesSelect } from '@/components/TaxRates/TaxRatesSelect';
import { ItemFormSectionTitle } from './ItemFormSectionTitle';

function ItemFormSellingSectionBase({ organization: { base_currency } }) {
  const { accounts, taxRates } = useItemFormContext();
  const { values } = useFormikContext();

  return (
    <Box data-section-id="selling">
      <ItemFormSectionTitle>Selling details</ItemFormSectionTitle>

      {/*------------- Sellable checkbox ------------- */}
      <FastField name={'sellable'} type="checkbox">
        {({ form, field }) => (
          <FormGroup inline={true} className={'form-group--sellable'}>
            <Checkbox
              inline={true}
              label={<T id={'i_sell_this_item'} />}
              name={'sellable'}
              {...field}
            />
          </FormGroup>
        )}
      </FastField>

      {/*------------- Selling price ------------- */}
      <FFormGroup
        name={'sell_price'}
        label={<T id={'selling_price'} />}
        inline
        fill
        fastField
      >
        <ControlGroup fill>
          <InputPrependText text={base_currency} />
          <FMoneyInputGroup
            name={'sell_price'}
            shouldUpdate={sellPriceFieldShouldUpdate}
            sellable={values.sellable}
            inputGroupProps={{ fill: true }}
            disabled={!values.sellable}
            fastField
          />
        </ControlGroup>
      </FFormGroup>

      {/*------------- Selling account ------------- */}
      <FFormGroup
        label={<T id={'account'} />}
        name={'sell_account_id'}
        labelInfo={
          <Hint content={<T id={'item.field.sell_account.hint'} />} />
        }
        inline={true}
        fill
        items={accounts}
        sellable={values.sellable}
        shouldUpdate={sellAccountFieldShouldUpdate}
        fastField={true}
      >
        <AccountsSelect
          name={'sell_account_id'}
          items={accounts}
          placeholder={<T id={'select_account'} />}
          disabled={!values.sellable}
          filterByParentTypes={[ACCOUNT_PARENT_TYPE.INCOME]}
          fill={true}
          allowCreate={true}
          fastField={true}
        />
      </FFormGroup>

      {/*------------- Sell Tax Rate ------------- */}
      <FFormGroup
        name={'sell_tax_rate_id'}
        label={'Tax Rate'}
        inline={true}
        fill
      >
        <TaxRatesSelect
          name={'sell_tax_rate_id'}
          items={taxRates}
          allowCreate
        />
      </FFormGroup>

      <FFormGroup
        name={'sell_description'}
        label={<T id={'description'} />}
        inline={true}
        fill
        sellable={values.sellable}
        shouldUpdate={sellDescriptionFieldShouldUpdate}
        fastField
      >
        <FTextArea
          name={'sell_description'}
          growVertically={true}
          height={280}
          disabled={!values.sellable}
          fill
          fastField
        />
      </FFormGroup>
    </Box>
  );
}

export const ItemFormSellingSection = compose(withCurrentOrganization())(
  ItemFormSellingSectionBase,
);

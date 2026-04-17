// @ts-nocheck
import React from 'react';
import { useFormikContext, FastField, ErrorMessage } from 'formik';
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
  costPriceFieldShouldUpdate,
  costAccountFieldShouldUpdate,
  purchaseDescFieldShouldUpdate,
  taxRateFieldShouldUpdate,
} from './utils';
import { compose } from '@/utils';
import { TaxRatesSelect } from '@/components/TaxRates/TaxRatesSelect';
import { ItemFormSectionTitle } from './ItemFormSectionTitle';

function ItemFormPurchasingSectionBase({ organization: { base_currency } }) {
  const { accounts, taxRates } = useItemFormContext();
  const { values } = useFormikContext();

  return (
    <Box data-section-id="purchasing">
      <ItemFormSectionTitle>Purchasing details</ItemFormSectionTitle>

      {/*------------- Purchasable checkbox ------------- */}
      <FastField name={'purchasable'} type={'checkbox'}>
        {({ field }) => (
          <FormGroup inline={true} className={'form-group--purchasable'}>
            <Checkbox
              inline={true}
              label={<T id={'i_purchase_this_item'} />}
              {...field}
            />
          </FormGroup>
        )}
      </FastField>

      {/*------------- Cost price ------------- */}
      <FFormGroup
        name={'cost_price'}
        label={<T id={'cost_price'} />}
        inline
        fill
        fastField
      >
        <ControlGroup fill>
          <InputPrependText text={base_currency} />
          <FMoneyInputGroup
            name={'cost_price'}
            shouldUpdate={costPriceFieldShouldUpdate}
            purchasable={values.purchasable}
            inputGroupProps={{ medium: true }}
            disabled={!values.purchasable}
            fastField
          />
        </ControlGroup>
      </FFormGroup>

      {/*------------- Cost account ------------- */}
      <FFormGroup
        name={'cost_account_id'}
        purchasable={values.purchasable}
        items={accounts}
        shouldUpdate={costAccountFieldShouldUpdate}
        label={<T id={'account'} />}
        labelInfo={
          <Hint content={<T id={'item.field.cost_account.hint'} />} />
        }
        inline={true}
        fill
        fastField={true}
      >
        <AccountsSelect
          name={'cost_account_id'}
          items={accounts}
          placeholder={<T id={'select_account'} />}
          filterByParentTypes={[ACCOUNT_PARENT_TYPE.EXPENSE]}
          popoverFill={true}
          allowCreate={true}
          fastField={true}
          disabled={!values.purchasable}
          purchasable={values.purchasable}
          shouldUpdate={costAccountFieldShouldUpdate}
        />
      </FFormGroup>

      {/*------------- Purchase Tax Rate ------------- */}
      <FFormGroup
        name={'purchase_tax_rate_id'}
        label={'Tax Rate'}
        inline={true}
        fill
        fastField={true}
        shouldUpdateDeps={{ taxRates }}
        shouldUpdate={taxRateFieldShouldUpdate}
      >
        <TaxRatesSelect
          name={'purchase_tax_rate_id'}
          items={taxRates}
          allowCreate={true}
          fastField={true}
          shouldUpdateDeps={{ taxRates }}
        />
      </FFormGroup>

      <FFormGroup
        name={'purchase_description'}
        label={<T id={'description'} />}
        className={'form-group--purchase-description'}
        helperText={<ErrorMessage name={'description'} />}
        inline={true}
        fill
        purchasable={values.purchasable}
        shouldUpdate={purchaseDescFieldShouldUpdate}
      >
        <FTextArea
          name={'purchase_description'}
          growVertically={true}
          height={280}
          disabled={!values.purchasable}
          fill
        />
      </FFormGroup>
    </Box>
  );
}

export const ItemFormPurchasingSection = compose(withCurrentOrganization())(
  ItemFormPurchasingSectionBase,
);

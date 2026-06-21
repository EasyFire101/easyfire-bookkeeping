// @ts-nocheck
import React from 'react';
import classNames from 'classnames';
import { FormGroup, ControlGroup, Position, Classes } from '@blueprintjs/core';
import { FastField, ErrorMessage, useFormikContext } from 'formik';
import { Features } from '@/constants';
import {
  FFormGroup,
  InputPrependText,
  CurrencySelectList,
  BranchSelect,
  FeatureCan,
  Row,
  Col,
  FMoneyInputGroup,
  ExchangeRateInputGroup,
  FDateInput,
} from '@/components';
import {
  openingBalanceFieldShouldUpdate,
  useIsVendorForeignCurrency,
  useSetPrimaryBranchToForm,
} from './utils';
import { useVendorFormContext } from './VendorFormProvider';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import intl from 'react-intl-universal';

/**
 * Vendor Finaniceal Panel Tab.
 */
export function VendorFinanicalPanelTab() {
  const { currencies, branches } = useVendorFormContext();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  return (
    <div className={'tab-panel--financial'}>
      <Row>
        <Col xs={6}>
          {/*------------ Currency  -----------*/}
          <FFormGroup
            name={'currency_code'}
            label={intl.get('currency')}
            fastField
            inline
            fastField
          >
            <CurrencySelectList
              name="currency_code"
              items={currencies}
              fastField
            />
          </FFormGroup>

          {/*------------ Opening balance -----------*/}
          <VendorOpeningBalanceField />
          <VendorOpeningBalanceExchangeRateField />

          {/*------------ Opening balance at  -----------*/}
          <VendorOpeningBalanceAtField />

          {/*------------ Opening branch  -----------*/}
          <FeatureCan feature={Features.Branches}>
            <FFormGroup
              label={intl.get('vendor.label.opening_branch')}
              name={'opening_balance_branch_id'}
              inline={true}
            >
              <BranchSelect
                name={'opening_balance_branch_id'}
                branches={branches}
                popoverProps={{ minimal: true }}
              />
            </FFormGroup>
          </FeatureCan>
        </Col>
      </Row>
    </div>
  );
}

/**
 * Vendor opening balance field.
 * @returns {JSX.Element}
 */
function VendorOpeningBalanceField() {
  const { vendorId } = useVendorFormContext();
  const { values } = useFormikContext();

  // Cannot continue if the vendor id is defined.
  if (vendorId) return null;

  return (
    <FFormGroup
      name={'opening_balance'}
      label={intl.get('opening_balance')}
      shouldUpdate={openingBalanceFieldShouldUpdate}
      shouldUpdateDeps={{ currencyCode: values.currency_code }}
      inline
      fastField
    >
      <ControlGroup>
        <InputPrependText text={values.currency_code} />
        <FMoneyInputGroup
          name={'opening_balance'}
          inputGroupProps={{ fill: true }}
          fastField
        />
      </ControlGroup>
    </FFormGroup>
  );
}

/**
 * Vendor opening balance at date field.
 * @returns {JSX.Element}
 */
function VendorOpeningBalanceAtField() {
  const { vendorId } = useVendorFormContext();

  // Cannot continue if the vendor id is defined.
  if (vendorId) return null;

  return (
    <FFormGroup
      name={'opening_balance_at'}
      label={intl.get('opening_balance_at')}
      helperText={<ErrorMessage name="opening_balance_at" />}
      inline
      fastField
    >
      <FDateInput
        name={'opening_balance_at'}
        popoverProps={{ position: Position.BOTTOM, minimal: true }}
        disabled={vendorId}
        formatDate={(date) => date.toLocaleDateString()}
        parseDate={(str) => new Date(str)}
        fill
        fastField
      />
    </FFormGroup>
  );
}

/**
 * Vendor opening balance exchange rate field if the vendor has foreign currency.
 * @returns {JSX.Element}
 */
function VendorOpeningBalanceExchangeRateField() {
  const { values } = useFormikContext();
  const { vendorId } = useVendorFormContext();
  const isForeignVendor = useIsVendorForeignCurrency();
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  // Cannot continue if the current vendor does not have foreign currency.
  if (!isForeignVendor || vendorId) {
    return null;
  }
  return (
    <FFormGroup
      label={' '}
      name={'opening_balance_exchange_rate'}
      inline
      fastField
    >
      <ExchangeRateInputGroup
        fromCurrency={values.currency_code}
        toCurrency={baseCurrency}
        name={'opening_balance_exchange_rate'}
        fastField
      />
    </FFormGroup>
  );
}

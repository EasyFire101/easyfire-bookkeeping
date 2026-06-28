// @ts-nocheck
import React from 'react';
import styled from 'styled-components';
import classNames from 'classnames';
import { useFormikContext } from 'formik';
import { Classes, Position } from '@blueprintjs/core';
import { css } from '@emotion/css';

import { FeatureCan, Stack, FormattedMessage as T } from '@/components';
import { CLASSES } from '@/constants/classes';
import {
  FFormGroup,
  FieldRequiredHint,
  Icon,
  VendorDrawerLink,
  VendorsSelect,
  FDateInput,
  FInputGroup,
} from '@/components';

import { useBillFormContext } from './BillFormProvider';
import { vendorsFieldShouldUpdate } from './utils';
import {
  BillExchangeRateInputField,
  BillProjectSelectButton,
} from './components';
import { ProjectsSelect } from '@/containers/Projects/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { momentFormatter, compose } from '@/utils';
import { Features } from '@/constants';
import { useTheme } from '@emotion/react';
import intl from 'react-intl-universal';

const getBillFieldsStyle = (theme: Theme) => css`
  .${theme.bpPrefix}-form-group {
    margin-bottom: 0;

    &.${theme.bpPrefix}-inline {
      max-width: 450px;
    }
    .${theme.bpPrefix}-label {
      min-width: 150px;
      font-weight: 500;
    }
    .${theme.bpPrefix}-form-content {
      width: 100%;
    }
  }
`;

/**
 * Fill form header.
 */
function BillFormHeader() {
  // Bill form context.
  const { vendors, projects } = useBillFormContext();

  const theme = useTheme();
  const billFieldsClassName = getBillFieldsStyle(theme);

  return (
    <Stack spacing={18} flex={1} className={billFieldsClassName}>
      {/* ------- Vendor name ------ */}
      <BillFormVendorField />

      {/* ----------- Exchange rate ----------- */}
      <BillExchangeRateInputField
        name={'exchangeRate'}
        formGroupProps={{ label: ' ', inline: true }}
      />

      {/* ------- Bill date ------- */}
      <FFormGroup
        name={'billDate'}
        label={intl.get('bill_date')}
        inline
        labelInfo={<FieldRequiredHint />}
        className={classNames(CLASSES.FILL)}
        fastField
      >
        <FDateInput
          name={'billDate'}
          {...momentFormatter('YYYY/MM/DD')}
          popoverProps={{ position: Position.BOTTOM, minimal: true }}
          inputProps={{ leftIcon: <Icon icon={'date-range'} /> }}
          fill
          fastField
        />
      </FFormGroup>

      {/* ------- Due date ------- */}
      <FFormGroup
        name={'dueDate'}
        label={intl.get('due_date')}
        inline
        fill
        fastField
      >
        <FDateInput
          name={'dueDate'}
          {...momentFormatter('YYYY/MM/DD')}
          popoverProps={{ position: Position.BOTTOM, minimal: true }}
          inputProps={{
            leftIcon: <Icon icon={'date-range'} />,
          }}
          fill
          fastField
        />
      </FFormGroup>

      {/* ------- Bill number ------- */}
      <FFormGroup
        name={'billNumber'}
        label={intl.get('bill_number')}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billNumber'} minimal={true} fastField />
      </FFormGroup>

      {/* ------- Reference ------- */}
      <FFormGroup
        name={'referenceNo'}
        label={intl.get('reference')}
        inline={true}
        fill
        fastField
      >
        <FInputGroup name={'referenceNo'} minimal={true} fastField />
      </FFormGroup>

      {/*------------ Project name -----------*/}
      <FeatureCan feature={Features.Projects}>
        <FFormGroup
          name={'projectId'}
          label={intl.get('bill.project_name.label')}
          inline={true}
          className={classNames('form-group--select-list', Classes.FILL)}
        >
          <ProjectsSelect
            name={'projectId'}
            projects={projects}
            input={BillProjectSelectButton}
            popoverFill={true}
          />
        </FFormGroup>
      </FeatureCan>
    </Stack>
  );
}

/**
 * Vendor select field of bill form.
 * @returns {JSX.Element}
 */
function BillFormVendorField() {
  const { values, setFieldValue } = useFormikContext();
  const { vendors } = useBillFormContext();

  return (
    <FFormGroup
      name={'vendorId'}
      label={intl.get('vendor_name')}
      inline={true}
      labelInfo={<FieldRequiredHint />}
      fastField={true}
      shouldUpdate={vendorsFieldShouldUpdate}
      shouldUpdateDeps={{ items: vendors }}
    >
      <VendorsSelect
        name={'vendorId'}
        items={vendors}
        placeholder={<T id={'select_vender_account'} />}
        onItemChange={(contact) => {
          setFieldValue('vendorId', contact.id);
          setFieldValue('currencyCode', contact?.currency_code);
        }}
        allowCreate={true}
        fastField={true}
        shouldUpdate={vendorsFieldShouldUpdate}
        shouldUpdateDeps={{ items: vendors }}
      />
      {values.vendorId && (
        <VendorButtonLink vendorId={values.vendorId}>
          <T id={'view_vendor_details'} />
        </VendorButtonLink>
      )}
    </FFormGroup>
  );
}

export const BillFormHeaderFields = compose(withDialogActions)(BillFormHeader);

const VendorButtonLink = styled(VendorDrawerLink)`
  font-size: 11px;
  margin-top: 6px;
`;

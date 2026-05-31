// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import classNames from 'classnames';
import { useFormikContext } from 'formik';
import { Classes, FormGroup, Position } from '@blueprintjs/core';
import {
  FFormGroup,

  FDateInput,
  FInputGroup,
  FTextArea,
  FSelect,
} from '@/components';
import { useAutofocus } from '@/hooks';
import {
  FieldRequiredHint,
  Col,
  Row,
  FeatureCan,
  BranchSelect,
  WarehouseSelect,
  FAccountsSuggestField,
} from '@/components';
import { momentFormatter, toSafeNumber } from '@/utils';
import { Features, CLASSES } from '@/constants';

import { useInventoryAdjContext } from './InventoryAdjustmentFormProvider';
import { useFeatureCan } from '@/hooks/state';

import { InventoryAdjustmentQuantityFields } from './InventoryAdjustmentQuantityFields';
import {
  diffQuantity,
  useSetPrimaryBranchToForm,
  useSetPrimaryWarehouseToForm,
  useGetAdjustmentTypeOptions,
} from './utils';

/**
 * Inventory adjustment form dialogs fields.
 */
export function InventoryAdjustmentFormDialogFields() {
  // Features guard.
  const { featureCan } = useFeatureCan();

  // Retrieves memorized adjustment types options.
  const adjustmentTypes = useGetAdjustmentTypeOptions();

  const dateFieldRef = useAutofocus();

  // Inventory adjustment dialog context.
  const { accounts, branches, warehouses } = useInventoryAdjContext();
  const { values, setFieldValue } = useFormikContext();

  // Sets the primary warehouse to form.
  useSetPrimaryWarehouseToForm();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  // Handle adjustment type change.
  const handleAdjustmentTypeChange = (type) => {
    const result = diffQuantity(
      toSafeNumber(values.quantity),
      toSafeNumber(values.quantity_on_hand),
      type.value,
    );
    setFieldValue('type', type.value);
    setFieldValue('new_quantity', result);
  };

  return (
    <div className={Classes.DIALOG_BODY}>
      <Row>
        <FeatureCan feature={Features.Branches}>
          <Col xs={5}>
            <FormGroup
              label={intl.get('branch')}
              fill
            >
              <BranchSelect
                name={'branch_id'}
                branches={branches}
                popoverProps={{ minimal: true }}
              />
            </FormGroup>
          </Col>
        </FeatureCan>
        <FeatureCan feature={Features.Warehouses}>
          <Col xs={5}>
            <FormGroup
              label={intl.get('warehouse')}
              fill
            >
              <WarehouseSelect
                name={'warehouse_id'}
                warehouses={warehouses}
                popoverProps={{ minimal: true }}
              />
            </FormGroup>
          </Col>
        </FeatureCan>
      </Row>

      {featureCan(Features.Warehouses) && featureCan(Features.Branches) && (
        <FeatureRowDivider />
      )}

      <Row>
        <Col xs={5}>
          {/*------------ Date -----------*/}
          <FFormGroup
            name={'date'}
            label={intl.get('date')}
            labelInfo={<FieldRequiredHint />}
            fill
            fastField
          >
            <FDateInput
              name={'date'}
              {...momentFormatter('YYYY/MM/DD')}
              popoverProps={{
                position: Position.BOTTOM,
                minimal: true,
              }}
              inputRef={(ref) => (dateFieldRef.current = ref)}
              fastField
            />
          </FFormGroup>
        </Col>

        <Col xs={5}>
          {/*------------ Adjustment type -----------*/}
          <FFormGroup
            name={'type'}
            label={intl.get('adjustment_type')}
            labelInfo={<FieldRequiredHint />}
            fill
            fastField
          >
            <FSelect
              name={'type'}
              items={adjustmentTypes}
              onItemChange={handleAdjustmentTypeChange}
              filterable={false}
              valueAccessor={'value'}
              textAccessor={'name'}
              popoverProps={{ minimal: true }}
              fastField
            />
          </FFormGroup>
        </Col>
      </Row>

      <InventoryAdjustmentQuantityFields />

      {/*------------ Adjustment account -----------*/}
      <FFormGroup
        name={'adjustment_account_id'}
        label={intl.get('adjustment_account')}
        labelInfo={<FieldRequiredHint />}
        fill
      >
        <FAccountsSuggestField
          name={'adjustment_account_id'}
          items={accounts}
          inputProps={{
            placeholder: intl.get('select_adjustment_account'),
          }}
          fill
          fastField
        />
      </FFormGroup>

      {/*------------ Reference -----------*/}
      <FFormGroup
        name={'reference_no'}
        label={intl.get('reference_no')}
        fastField
      >
        <FInputGroup name={'reference_no'} fastField />
      </FFormGroup>

      {/*------------ Adjustment reasons -----------*/}
      <FFormGroup
        name={'reason'}
        label={intl.get('adjustment_reasons')}
        labelInfo={<FieldRequiredHint />}
        fill
        fastField
      >
        <FTextArea name={'reason'} growVertically large fastField fill />
      </FFormGroup>
    </div>
  );
}

export const FeatureRowDivider = styled.div`
  --x-color-background: #e9e9e9;
  .bp4-dark & {
    --x-color-background: rgba(255, 255, 255, 0.1);
  }
  height: 2px;
  background: var(--x-color-background);
  margin-bottom: 15px;
`;

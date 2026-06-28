// @ts-nocheck
import React from 'react';
import { Field, ErrorMessage, FastField, useFormikContext } from 'formik';
import { FormGroup, InputGroup } from '@blueprintjs/core';
import { inputIntent, toSafeNumber } from '@/utils';
import {
  Row,
  Col,
  MoneyInputGroup,
  FMoneyInputGroup,
  FFormGroup,
  FInputGroup,
} from '@/components';
import { useAutofocus } from '@/hooks';
import { decrementQuantity } from './utils';
import intl from 'react-intl-universal';

/**
 * Decrement adjustment fields.
 */
export function DecrementAdjustmentFields() {
  const decrementFieldRef = useAutofocus();
  const { values, setFieldValue } = useFormikContext();

  return (
    <Row className={'row--decrement-fields'}>
      {/*------------ Quantity on hand  -----------*/}
      <Col className={'col--quantity-on-hand'}>
        <FFormGroup name={'quantityOnHand'} label={intl.get('qty_on_hand')}>
          <FInputGroup
            name={'quantityOnHand'}
            disabled={true}
            medium={'true'}
          />
        </FFormGroup>
      </Col>

      <Col className={'col--sign'}>
        <span>–</span>
      </Col>

      {/*------------ Decrement -----------*/}
      <Col className={'col--decrement'}>
        <FFormGroup name={'quantity'} label={intl.get('decrement')} fill>
          <FMoneyInputGroup
            name={'quantity'}
            allowDecimals={false}
            allowNegativeValue={true}
            inputRef={(ref) => (decrementFieldRef.current = ref)}
            onBlurValue={(value) => {
              setFieldValue(
                'newQuantity',
                decrementQuantity(
                  toSafeNumber(value),
                  toSafeNumber(values.quantityOnHand),
                ),
              );
            }}
          />
        </FFormGroup>
      </Col>

      <Col className={'col--sign'}>
        <span>=</span>
      </Col>
      {/*------------ New quantity -----------*/}
      <Col className={'col--quantity'}>
        <FFormGroup
          name={'newQuantity'}
          label={intl.get('new_quantity')}
          fill
          fastField
        >
          <FMoneyInputGroup
            name={'newQuantity'}
            allowDecimals={false}
            allowNegativeValue={true}
            onBlurValue={(value) => {
              setFieldValue(
                'quantity',
                decrementQuantity(
                  toSafeNumber(value),
                  toSafeNumber(values.quantityOnHand),
                ),
              );
            }}
          />
        </FFormGroup>
      </Col>
    </Row>
  );
}

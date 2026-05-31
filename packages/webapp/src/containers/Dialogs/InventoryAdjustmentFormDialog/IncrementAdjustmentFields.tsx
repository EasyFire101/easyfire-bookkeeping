// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import { useAutofocus } from '@/hooks';
import {
  Row,
  Col,
  FMoneyInputGroup,

  FFormGroup,
  FInputGroup,
} from '@/components';
import { toSafeNumber } from '@/utils';
import { decrementQuantity, incrementQuantity } from './utils';
import intl from 'react-intl-universal';

export function IncrementAdjustmentFields() {
  const incrementFieldRef = useAutofocus();
  const { values, setFieldValue } = useFormikContext();

  return (
    <Row>
      {/*------------ Quantity on hand  -----------*/}
      <Col className={'col--quantity-on-hand'}>
        <FFormGroup
          name={'quantity_on_hand'}
          label={intl.get('qty_on_hand')}
          fastField
        >
          <FInputGroup
            name={'quantity_on_hand'}
            disabled={true}
            medium={'true'}
            fastField
          />
        </FFormGroup>
      </Col>

      {/*------------ Sign -----------*/}
      <Col className={'col--sign'}>
        <span>+</span>
      </Col>

      {/*------------ Increment -----------*/}
      <Col className={'col--quantity'}>
        <FFormGroup
          name={'quantity'}
          label={intl.get('increment')}
          fill
          fastField
        >
          <FMoneyInputGroup
            name={'quantity'}
            allowDecimals={false}
            allowNegativeValue={true}
            inputRef={(ref) => (incrementFieldRef.current = ref)}
            onBlurValue={(value) => {
              setFieldValue(
                'new_quantity',
                incrementQuantity(
                  toSafeNumber(value),
                  toSafeNumber(values.quantity_on_hand),
                ),
              );
            }}
            fastField
          />
        </FFormGroup>
      </Col>

      {/*------------ Cost -----------*/}
      <Col className={'col--cost'}>
        <FFormGroup name={'cost'} label={intl.get('cost')} fastField>
          <FMoneyInputGroup name={'cost'} fastField />
        </FFormGroup>
      </Col>

      {/*------------ Sign -----------*/}
      <Col className={'col--sign'}>
        <span>=</span>
      </Col>

      {/*------------ New quantity -----------*/}
      <Col className={'col--quantity-on-hand'}>
        <FFormGroup
          name={'new_quantity'}
          label={intl.get('new_quantity')}
          fastField
        >
          <FMoneyInputGroup
            name={'new_quantity'}
            allowDecimals={false}
            allowNegativeValue={true}
            onBlurValue={(value) => {
              setFieldValue(
                'quantity',
                decrementQuantity(
                  toSafeNumber(value),
                  toSafeNumber(values.quantity_on_hand),
                ),
              );
            }}
            fastField
          />
        </FFormGroup>
      </Col>
    </Row>
  );
}

// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import {
  FormGroup,
  RadioGroup,
  Radio,
  Position,
  Checkbox,
} from '@blueprintjs/core';
import { ErrorMessage, FastField } from 'formik';
import {
  Hint,
  FieldRequiredHint,
  FormattedMessage as T,
  FormattedHTMLMessage,
  FFormGroup,
  FSelect,
  FInputGroup,
  Box,
} from '@/components';

import { useItemFormContext } from './ItemFormProvider';
import { handleStringChange, inputIntent } from '@/utils';
import { ItemFormSectionTitle } from './ItemFormSectionTitle';

export function ItemFormBasicSection() {
  const { isNewMode, item, itemsCategories } = useItemFormContext();
  const nameFieldRef = useRef(null);

  useEffect(() => {
    if (nameFieldRef.current) {
      nameFieldRef.current.focus();
    }
  }, []);

  const itemTypeHintContent = (
    <>
      <div className="mb1">
        <FormattedHTMLMessage id={'services_that_you_provide_to_customers'} />
      </div>
      <div className="mb1">
        <FormattedHTMLMessage id={'products_you_buy_and_or_sell'} />
      </div>
    </>
  );

  return (
    <Box data-section-id="primary">
      <ItemFormSectionTitle>Basic details</ItemFormSectionTitle>

      {/*----------- Item type ----------*/}
      <FastField name={'type'}>
        {({ form, field: { value }, meta: { touched, error } }) => (
          <FormGroup
            medium={true}
            label={<T id={'item_type'} />}
            labelInfo={
              <span>
                <FieldRequiredHint />
                <Hint
                  content={itemTypeHintContent}
                  position={Position.BOTTOM_LEFT}
                />
              </span>
            }
            className={'form-group--item-type'}
            intent={inputIntent({ error, touched })}
            helperText={<ErrorMessage name="item_type" />}
            inline={true}
          >
            <RadioGroup
              inline={true}
              onChange={handleStringChange((_value) => {
                form.setFieldValue('type', _value);
              })}
              selectedValue={value}
              disabled={!isNewMode && item.type === 'inventory'}
            >
              <Radio label={<T id={'service'} />} value="service" />
              <Radio label={<T id={'inventory'} />} value="inventory" />
            </RadioGroup>
          </FormGroup>
        )}
      </FastField>

      {/*----------- Item name ----------*/}
      <FFormGroup
        name={'name'}
        label={<T id={'item_name'} />}
        labelInfo={<FieldRequiredHint />}
        inline={true}
        fill
        fastField
      >
        <FInputGroup
          name={'name'}
          medium={true}
          inputRef={(ref) => (nameFieldRef.current = ref)}
          fastField
          fill
        />
      </FFormGroup>

      {/*----------- SKU ----------*/}
      <FFormGroup
        name={'code'}
        label={<T id={'item_code'} />}
        inline={true}
        fill
        fastField
      >
        <FInputGroup name={'code'} medium={true} fastField fill />
      </FFormGroup>

      {/*----------- Item category ----------*/}
      <FFormGroup
        name={'category_id'}
        label={<T id={'category'} />}
        inline={true}
        fill
      >
        <FSelect
          name={'category_id'}
          items={itemsCategories}
          valueAccessor={'id'}
          textAccessor={'name'}
          placeholder={<T id={'select_category'} />}
          popoverProps={{ minimal: true, captureDismiss: true }}
          fill
        />
      </FFormGroup>

      {/*----------- Active ----------*/}
      <FastField name={'active'} type={'checkbox'}>
        {({ field }) => (
          <FormGroup inline={true} className={'form-group--active'}>
            <Checkbox
              inline={true}
              label={<T id={'active'} />}
              name={'active'}
              {...field}
            />
          </FormGroup>
        )}
      </FastField>
    </Box>
  );
}

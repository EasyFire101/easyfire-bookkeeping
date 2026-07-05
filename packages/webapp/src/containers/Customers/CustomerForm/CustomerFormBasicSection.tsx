// @ts-nocheck
import {
  ControlGroup,
  Divider,
  Icon as BlueprintIcon,
} from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import { CustomerFormSectionTitle } from './CustomerFormSectionTitle';
import { CustomerTypeRadioField } from './CustomerTypeRadioField';
import {
  Hint,
  FieldRequiredHint,
  SalutationList,
  DisplayNameList,
  FInputGroup,
  FFormGroup,
  Box,
  Icon,
  Stack,
} from '@/components';
import { useAutofocus } from '@/hooks';

export function CustomerFormBasicSection({}) {
  const firstNameFieldRef = useAutofocus();

  return (
    <Box data-section-id="primary">
      <CustomerFormSectionTitle>Customer details</CustomerFormSectionTitle>

      {/**-----------Customer type. -----------*/}
      <CustomerTypeRadioField />

      {/**----------- Contact name -----------*/}
      <FFormGroup
        name={'salutation'}
        label={intl.get('contact_name')}
        inline
        fill
      >
        <ControlGroup fill>
          <SalutationList
            name={'salutation'}
            popoverProps={{ minimal: true }}
          />
          <FInputGroup
            name={'first_name'}
            placeholder={intl.get('first_name')}
            inputRef={(ref) => (firstNameFieldRef.current = ref)}
            fill
          />
          <FInputGroup
            name={'last_name'}
            placeholder={intl.get('last_name')}
            fill
          />
        </ControlGroup>
      </FFormGroup>

      <FFormGroup
        name={'code'}
        label={'Customer Code'}
        helperText="Add a unique account number to identify, reference and search for the contact."
        inline
        fill
      >
        <FInputGroup name={'code'} fill />
      </FFormGroup>

      {/*----------- Company Name -----------*/}
      <FFormGroup
        name={'company_name'}
        label={intl.get('company_name')}
        inline
        fill
      >
        <FInputGroup name={'company_name'} fill />
      </FFormGroup>

      {/*----------- Display Name -----------*/}
      <FFormGroup
        name={'display_name'}
        label={intl.get('display_name')}
        helperText="This is the name that appears on invoices and emails."
        inline
        fill
      >
        <DisplayNameList
          name={'display_name'}
          popoverProps={{ minimal: true }}
          buttonProps={{ fill: true }}
        />
      </FFormGroup>

      <Divider style={{ margin: '20px 0' }} />

      {/*------------ Vendor email -----------*/}
      <FFormGroup name={'email'} label={intl.get('vendor_email')} inline>
        <FInputGroup name={'email'} leftIcon={<Icon icon="envelope" />} />
      </FFormGroup>

      {/*------------ Phone number -----------*/}
      <FFormGroup
        name={'work_phone'}
        className={'form-group--phone-number'}
        label={intl.get('phone_number')}
        inline={true}
      >
        <Stack spacing={10}>
          <FInputGroup
            name={'work_phone'}
            placeholder={intl.get('work')}
            leftIcon="phone"
          />
          <FInputGroup
            name={'personal_phone'}
            placeholder={intl.get('mobile')}
          />
        </Stack>
      </FFormGroup>

      {/*------------ Vendor website -----------*/}
      <FFormGroup name={'website'} label={intl.get('website')} inline={true}>
        <FInputGroup
          name={'website'}
          placeholder={'http://'}
          leftIcon={<BlueprintIcon icon="globe-network" />}
        />
      </FFormGroup>
    </Box>
  );
}

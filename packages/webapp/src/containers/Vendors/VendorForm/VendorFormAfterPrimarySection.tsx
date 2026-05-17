// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import { ControlGroup } from '@blueprintjs/core';
import { FormattedMessage as T, FFormGroup, FInputGroup, Box } from '@/components';

/**
 * Vendor form  after primary section.
 */
export function VendorFormAfterPrimarySection() {
  return (
    <Box>
      {/*------------ Vendor email -----------*/}
      <FFormGroup
        name={'email'}
        label={<T id={'vendor_email'} />}
        inline
        fastField
      >
        <FInputGroup name={'email'} fastField />
      </FFormGroup>

      {/*------------ Phone number -----------*/}
      <FFormGroup
        name={'work_phone'}
        className={'form-group--phone-number'}
        label={<T id={'phone_number'} />}
        inline
        fastField
      >
        <ControlGroup>
          <FInputGroup name={'work_phone'} placeholder={intl.get('work')} fastField />
          <FInputGroup
            name={'personal_phone'}
            placeholder={intl.get('mobile')}
            fastField
          />
        </ControlGroup>
      </FFormGroup>

      {/*------------ Vendor website -----------*/}
      <FFormGroup name={'website'} label={<T id={'website'} />} inline fastField>
        <FInputGroup name={'website'} placeholder={'http://'} fastField />
      </FFormGroup>
    </Box>
  );
}

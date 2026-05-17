// @ts-nocheck
import React from 'react';
import { FormattedMessage as T, FFormGroup, FTextArea } from '@/components';

export default function CustomerNotePanel({ errors, touched, getFieldProps }) {
  return (
    <FFormGroup name={'note'} label={<T id={'note'} />} inline={false} fill>
      <FTextArea name={'note'} fill />
    </FFormGroup>
  );
}

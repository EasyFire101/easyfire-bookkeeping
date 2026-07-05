// @ts-nocheck
import { Intent, Position } from '@blueprintjs/core';
import { Formik } from 'formik';
import { isEmpty } from 'lodash';
import React from 'react';
import intl from 'react-intl-universal';
import { useHistory } from 'react-router-dom';
import { AuthInsiderCard } from './_components';
import { InviteUserFormContent as InviteAcceptFormContent } from './InviteAcceptFormContent';
import { useInviteAcceptContext } from './InviteAcceptProvider';
import { InviteAcceptSchema } from './utils';
import { AppToaster } from '@/components';

const initialValues = {
  organization_name: '',
  invited_email: '',
  first_name: '',
  last_name: '',
  password: '',
};

export function InviteAcceptForm() {
  const history = useHistory();

  // Invite accept context.
  const { inviteAcceptMutate, inviteMeta, token } = useInviteAcceptContext();

  // Invite value.
  const inviteFormValue = {
    ...initialValues,
    ...(!isEmpty(inviteMeta)
      ? {
          invited_email: inviteMeta.email,
          organization_name: inviteMeta.organizationName,
        }
      : {}),
  };

  // Handle form submitting.
  const handleSubmit = (values, { setSubmitting, setErrors }) => {
    inviteAcceptMutate([values, token])
      .then(() => {
        AppToaster.show({
          message: intl.getHTML(
            'congrats_your_account_has_been_created_and_invited',
            {
              organization_name: inviteMeta.organizationName,
            },
          ),
          intent: Intent.SUCCESS,
        });
        history.push('/auth/login');
      })
      .catch(({ data: { errors } }) => {
        if (errors.find((e) => e.type === 'INVITE_TOKEN_INVALID')) {
          AppToaster.show({
            message: intl.get('an_unexpected_error_occurred'),
            intent: Intent.DANGER,
            position: Position.BOTTOM,
          });
          history.push('/auth/login');
        }
        if (errors.find((e) => e.type === 'PHONE_MUMNER.ALREADY.EXISTS')) {
          setErrors({
            phone_number: 'This phone number is used in another account.',
          });
        }
        setSubmitting(false);
      });
  };

  return (
    <AuthInsiderCard>
      <Formik
        validationSchema={InviteAcceptSchema}
        initialValues={inviteFormValue}
        onSubmit={handleSubmit}
        component={InviteAcceptFormContent}
      />
    </AuthInsiderCard>
  );
}

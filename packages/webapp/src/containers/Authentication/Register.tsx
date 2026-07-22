// @ts-nocheck
import { Intent } from '@blueprintjs/core';
import { Formik } from 'formik';
import intl from 'react-intl-universal';
import { Link } from 'react-router-dom';
import {
  AuthFooterLinks,
  AuthFooterLink,
  AuthInsiderCard,
} from './_components';
import { RegisterForm } from './RegisterForm';
import {
  RegisterSchema,
  transformRegisterErrorsToForm,
  transformRegisterToastMessages,
} from './utils';
import { AppToaster, FormattedMessage as T } from '@/components';
import { AuthInsider } from '@/containers/Authentication/AuthInsider';
import { useAuthLogin, useAuthRegister } from '@/hooks/query/authentication';

const initialValues = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
};

/**
 * Register form.
 */
export function RegisterUserForm() {
  const { mutateAsync: authLoginMutate } = useAuthLogin();
  const { mutateAsync: authRegisterMutate } = useAuthRegister();

  const handleSubmit = async (values, { setSubmitting, setErrors }) => {
    try {
      await authRegisterMutate(values);

      try {
        await authLoginMutate({
          email: values.email,
          password: values.password,
        });
      } catch {
        AppToaster.show({
          message: intl.get('something_wentwrong'),
          intent: Intent.DANGER,
        });
      }
    } catch (error) {
      const errors = error?.data?.errors ?? error?.response?.data?.errors ?? [];

      if (Array.isArray(errors)) {
        const formErrors = transformRegisterErrorsToForm(errors);
        const toastMessages = transformRegisterToastMessages(errors);

        toastMessages.forEach((toastMessage) => {
          AppToaster.show(toastMessage);
        });
        setErrors(formErrors);
      }

      if (!Array.isArray(errors) || errors.length === 0) {
        AppToaster.show({
          message: intl.get('something_wentwrong'),
          intent: Intent.DANGER,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthInsider>
      <AuthInsiderCard>
        <Formik
          initialValues={initialValues}
          validationSchema={RegisterSchema}
          onSubmit={handleSubmit}
          component={RegisterForm}
        />
      </AuthInsiderCard>

      <RegisterFooterLinks />
    </AuthInsider>
  );
}

function RegisterFooterLinks() {
  return (
    <AuthFooterLinks>
      <AuthFooterLink>
        <T id={'return_to'} />{' '}
        <Link to={'/auth/login'}>
          <T id={'sign_in'} />
        </Link>
      </AuthFooterLink>

      <AuthFooterLink>
        <Link to={'/auth/send_reset_password'}>
          <T id={'forgot_my_password'} />
        </Link>
      </AuthFooterLink>
    </AuthFooterLinks>
  );
}

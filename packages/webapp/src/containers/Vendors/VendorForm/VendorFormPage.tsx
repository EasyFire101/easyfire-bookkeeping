// @ts-nocheck
import React from 'react';
import styled from 'styled-components';
import { useParams, useHistory } from 'react-router-dom';
import { Box, DashboardCard, DashboardInsider } from '@/components';
import { VendorFormProvider, useVendorFormContext } from './VendorFormProvider';
import { VendorFormFormik } from './VendorFormFormik';

/**
 * Vendor form page loading wrapper.
 * @returns {JSX}
 */
function VendorFormPageLoading({ children }) {
  const { isFormLoading } = useVendorFormContext();

  return (
    <DashboardInsider loading={isFormLoading}>
      {children}
    </DashboardInsider>
  );
}

/**
 * Vendor form page.
 */
export function VendorFormPage() {
  const history = useHistory();
  const { id } = useParams();

  // Handle the form submit success.
  const handleSubmitSuccess = (values, formArgs, submitPayload) => {
    if (!submitPayload.noRedirect) {
      history.push('/vendors');
    }
  };
  // Handle the form cancel button click.
  const handleFormCancel = () => {
    history.goBack();
  };

  return (
    <VendorFormProvider vendorId={id}>
      <VendorFormPageLoading>
        <Box mx={'auto'} maxWidth={800}>
          <VendorFormFormik
            onSubmitSuccess={handleSubmitSuccess}
            onCancel={handleFormCancel}
            />
        </Box>
      </VendorFormPageLoading>
    </VendorFormProvider>
  );
}

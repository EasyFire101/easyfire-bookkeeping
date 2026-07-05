// @ts-nocheck
import classNames from 'classnames';
import React from 'react';
import styled from 'styled-components';
import { PreferencesPageLoader } from '../PreferencesPageLoader';
import { Card } from '@/components';
import { CLASSES } from '@/constants/classes';
import { useSettings } from '@/hooks/query';

const PreferencesReceiptsFormContext = React.createContext();

function PreferencesReceiptsBoot({ ...props }) {
  // Fetches organization settings.
  const { isLoading: isSettingsLoading } = useSettings();

  // Provider state.
  const provider = {
    isSettingsLoading,
  };

  // Detarmines whether if any query is loading.
  const isLoading = isSettingsLoading;

  return (
    <div
      className={classNames(
        CLASSES.PREFERENCES_PAGE_INSIDE_CONTENT,
        CLASSES.PREFERENCES_PAGE_INSIDE_CONTENT_ACCOUNTANT,
      )}
    >
      <PreferencesReceiptsCard>
        {isLoading ? (
          <PreferencesPageLoader />
        ) : (
          <PreferencesReceiptsFormContext.Provider
            value={provider}
            {...props}
          />
        )}
      </PreferencesReceiptsCard>
    </div>
  );
}

const PreferencesReceiptsCard = styled(Card)`
  padding: 25px;

  .bp4-form-group {
    max-width: 600px;
  }
`;

const usePreferencesReceiptsFormContext = () =>
  React.useContext(PreferencesReceiptsFormContext);

export { PreferencesReceiptsBoot, usePreferencesReceiptsFormContext };

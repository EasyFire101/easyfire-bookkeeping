import React, { useRef } from 'react';
import classNames from 'classnames';
import {
  Classes,
  Intent,
  Menu,
  MenuItem,
  ProgressBar,
  Text,
} from '@blueprintjs/core';

import { useARAgingSummaryContext } from './ARAgingSummaryProvider';
import { AppToaster, If, Stack } from '@/components';
import { FinancialLoadingBar } from '../FinancialLoadingBar';
import { agingSummaryDynamicColumns } from '../AgingSummary/dynamicColumns';
import {
  useARAgingSheetCsvExport,
  useARAgingSheetXlsxExport,
} from '@/hooks/query';

export const useARAgingSummaryColumns = () => {
  const { ARAgingSummary } = useARAgingSummaryContext();

  return agingSummaryDynamicColumns(
    (ARAgingSummary as any)?.table?.columns ?? [],
    (ARAgingSummary as any)?.table?.rows ?? [],
  );
};

export function ARAgingSummarySheetLoadingBar() {
  const { isARAgingFetching } = useARAgingSummaryContext();

  return (
    <If condition={isARAgingFetching}>
      <FinancialLoadingBar />
    </If>
  );
}

export function ARAgingSummaryExportMenu() {
  const toastKey = useRef<string | undefined>(undefined);
  const commonToastConfig = {
    isCloseButtonShown: true,
    timeout: 2000,
  };
  const { httpQuery } = useARAgingSummaryContext();

  const openProgressToast = (amount: number) => {
    return (
      <Stack spacing={8}>
        <Text>The report has been exported successfully.</Text>
        <ProgressBar
          className={classNames('toast-progress', {
            [Classes.PROGRESS_NO_STRIPES]: amount >= 100,
          })}
          intent={amount < 100 ? Intent.PRIMARY : Intent.SUCCESS}
          value={amount / 100}
        />
      </Stack>
    );
  };

  const { mutateAsync: xlsxExport } = useARAgingSheetXlsxExport(httpQuery, {
    onDownloadProgress: (xlsxExportProgress: number) => {
      if (!toastKey.current) {
        toastKey.current = AppToaster.show({
          message: openProgressToast(xlsxExportProgress),
          ...commonToastConfig,
        });
      } else {
        AppToaster.show(
          {
            message: openProgressToast(xlsxExportProgress),
            ...commonToastConfig,
          },
          toastKey.current,
        );
      }
    },
  });

  const { mutateAsync: csvExport } = useARAgingSheetCsvExport(httpQuery, {
    onDownloadProgress: (xlsxExportProgress: number) => {
      if (!toastKey.current) {
        toastKey.current = AppToaster.show({
          message: openProgressToast(xlsxExportProgress),
          ...commonToastConfig,
        });
      } else {
        AppToaster.show(
          {
            message: openProgressToast(xlsxExportProgress),
            ...commonToastConfig,
          },
          toastKey.current,
        );
      }
    },
  });

  const handleCsvExportBtnClick = () => {
    csvExport();
  };
  const handleXlsxExportBtnClick = () => {
    xlsxExport();
  };

  return (
    <Menu>
      <MenuItem
        text={'XLSX (Microsoft Excel)'}
        onClick={handleXlsxExportBtnClick}
      />
      <MenuItem text={'CSV'} onClick={handleCsvExportBtnClick} />
    </Menu>
  );
}

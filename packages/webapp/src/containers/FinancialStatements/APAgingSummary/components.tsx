import { useRef } from 'react';
import classNames from 'classnames';

import { AppToaster, If, Stack } from '@/components';
import { FinancialLoadingBar } from '../FinancialLoadingBar';
import { useAPAgingSummaryContext } from './APAgingSummaryProvider';
import { agingSummaryDynamicColumns } from '../AgingSummary/dynamicColumns';
import {
  Classes,
  Intent,
  Menu,
  MenuItem,
  ProgressBar,
  Text,
} from '@blueprintjs/core';
import {
  useAPAgingSheetCsvExport,
  useAPAgingSheetXlsxExport,
} from '@/hooks/query';

export const useAPAgingSummaryColumns = () => {
  const { APAgingSummary } = useAPAgingSummaryContext();

  return agingSummaryDynamicColumns(
    (APAgingSummary as any)?.table?.columns ?? [],
    (APAgingSummary as any)?.table?.rows ?? [],
  );
};

export function APAgingSummarySheetLoadingBar() {
  const { isAPAgingFetching } = useAPAgingSummaryContext();

  return (
    <If condition={isAPAgingFetching}>
      <FinancialLoadingBar />
    </If>
  );
}

export function APAgingSummaryExportMenu() {
  const toastKey = useRef<string | undefined>(undefined);
  const commonToastConfig = { isCloseButtonShown: true, timeout: 2000 };
  const { httpQuery } = useAPAgingSummaryContext();

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

  const { mutateAsync: xlsxExport } = useAPAgingSheetXlsxExport(httpQuery, {
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

  const { mutateAsync: csvExport } = useAPAgingSheetCsvExport(httpQuery, {
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

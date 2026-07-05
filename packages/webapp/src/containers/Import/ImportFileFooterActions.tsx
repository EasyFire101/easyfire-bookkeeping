// @ts-nocheck
import { Button, Intent } from '@blueprintjs/core';
import clsx from 'classnames';
import { useFormikContext } from 'formik';
import styles from './ImportFileActions.module.scss';
import { useImportFileContext } from './ImportFileProvider';
import { Group } from '@/components';
import { CLASSES } from '@/constants';

export function ImportFileUploadFooterActions() {
  const { isSubmitting } = useFormikContext();
  const { onCancelClick } = useImportFileContext();

  const handleCancelBtnClick = () => {
    onCancelClick && onCancelClick();
  };

  return (
    <div className={clsx(CLASSES.PAGE_FORM_FLOATING_ACTIONS, styles.root)}>
      <Group spacing={10}>
        <Button onClick={handleCancelBtnClick}>Cancel</Button>
        <Button type="submit" intent={Intent.PRIMARY} loading={isSubmitting}>
          Next
        </Button>
      </Group>
    </div>
  );
}

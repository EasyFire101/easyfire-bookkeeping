// @ts-nocheck
import { AnchorButton } from '@blueprintjs/core';
import React from 'react';
import { DialogContent, PdfDocumentPreview, T } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { usePdfInvoice } from '@/hooks/query';
import { compose } from '@/utils';

function InvoicePdfPreviewDialogContentInner({
  subscriptionForm: { invoiceId },
  // #withDialog
  closeDialog,
}) {
  const { isLoading, pdfUrl, filename } = usePdfInvoice(invoiceId);

  return (
    <DialogContent>
      <div class="dialog__header-actions">
        <AnchorButton
          href={pdfUrl}
          target={'__blank'}
          minimal={true}
          outlined={true}
        >
          <T id={'pdf_preview.preview.button'} />
        </AnchorButton>

        <AnchorButton
          href={pdfUrl}
          download={filename}
          minimal={true}
          outlined={true}
        >
          <T id={'pdf_preview.download.button'} />
        </AnchorButton>
      </div>

      <PdfDocumentPreview
        height={760}
        width={1000}
        isLoading={isLoading}
        url={pdfUrl}
      />
    </DialogContent>
  );
}

export const InvoicePdfPreviewDialogContent = compose(withDialogActions)(
  InvoicePdfPreviewDialogContentInner,
);

import './dialogService.css';

export type AppConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type AppPromptOptions = AppConfirmOptions & {
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  minLength?: number;
};

type DialogKind = 'alert' | 'confirm' | 'prompt';
type DialogOptions = AppPromptOptions;

let nextDialogId = 1;
let dialogQueue: Promise<void> = Promise.resolve();

function enqueueDialog<T>(task: () => Promise<T>): Promise<T> {
  const result = dialogQueue.then(task, task);
  dialogQueue = result.then(() => undefined, () => undefined);
  return result;
}

function presentDialog<T>(
  kind: DialogKind,
  message: string,
  options: DialogOptions,
  cancelValue: T,
): Promise<T> {
  return enqueueDialog(() => new Promise<T>((resolve) => {
    if (typeof document === 'undefined' || !document.body) {
      resolve(cancelValue);
      return;
    }

    const dialogId = nextDialogId++;
    const titleId = `qe-app-dialog-title-${dialogId}`;
    const messageId = `qe-app-dialog-message-${dialogId}`;
    const dialog = document.createElement('dialog');
    dialog.className = 'qe-app-dialog';
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.setAttribute('aria-describedby', messageId);

    const form = document.createElement('form');
    form.className = 'qe-app-dialog__content';

    const heading = document.createElement('div');
    heading.className = 'qe-app-dialog__heading';

    const mark = document.createElement('span');
    mark.className = 'qe-app-dialog__mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = kind === 'alert' ? 'i' : kind === 'prompt' ? '✎' : '?';

    const headingCopy = document.createElement('div');
    headingCopy.className = 'qe-app-dialog__heading-copy';

    const title = document.createElement('h2');
    title.className = 'qe-app-dialog__title';
    title.id = titleId;
    title.textContent = options.title ?? (
      kind === 'alert' ? 'Notice' : kind === 'prompt' ? 'Enter details' : 'Confirm action'
    );

    const subtitle = document.createElement('p');
    subtitle.className = 'qe-app-dialog__subtitle';
    subtitle.textContent = kind === 'alert' ? 'Lucky Bajaj' : 'Please review this action';

    const description = document.createElement('p');
    description.className = 'qe-app-dialog__message';
    description.id = messageId;
    description.textContent = message;

    headingCopy.append(title, subtitle);
    heading.append(mark, headingCopy);
    form.append(heading, description);

    let promptField: HTMLInputElement | HTMLTextAreaElement | null = null;
    if (kind === 'prompt') {
      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'qe-app-dialog__field';

      const label = document.createElement('label');
      label.className = 'qe-app-dialog__label';
      label.textContent = options.inputLabel ?? 'Your response';

      promptField = options.multiline
        ? document.createElement('textarea')
        : document.createElement('input');
      promptField.className = 'qe-app-dialog__input';
      promptField.id = `qe-app-dialog-input-${dialogId}`;
      promptField.name = 'response';
      promptField.value = options.defaultValue ?? '';
      promptField.placeholder = options.placeholder ?? '';
      label.htmlFor = promptField.id;
      if (promptField instanceof HTMLTextAreaElement) {
        promptField.rows = 3;
      } else {
        promptField.type = 'text';
      }
      promptField.addEventListener('input', () => promptField?.setCustomValidity(''));
      fieldWrap.append(label, promptField);
      form.append(fieldWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'qe-app-dialog__actions';

    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(cancelValue);
    });

    if (kind !== 'alert') {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'qe-app-dialog__button qe-app-dialog__button--secondary';
      cancel.textContent = options.cancelLabel ?? 'Cancel';
      cancel.addEventListener('click', () => finish(cancelValue));
      actions.append(cancel);
    }

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'qe-app-dialog__button';
    if (kind === 'confirm' && options.danger) {
      submit.classList.add('qe-app-dialog__button--danger');
    } else {
      submit.classList.add('qe-app-dialog__button--primary');
    }
    submit.textContent = options.confirmLabel ?? (
      kind === 'alert' ? 'Okay' : kind === 'prompt' ? 'Continue' : 'Confirm'
    );
    actions.append(submit);
    form.append(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (kind === 'prompt' && promptField) {
        const value = promptField.value;
        const minLength = options.minLength ?? 0;
        if (minLength > 0 && value.trim().length < minLength) {
          promptField.setCustomValidity(`Please enter at least ${minLength} characters.`);
          promptField.reportValidity();
          return;
        }
        finish(value as T);
        return;
      }
      finish((kind === 'confirm' ? true : undefined) as T);
    });

    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    if (promptField) {
      promptField.focus();
    } else {
      submit.focus();
    }
  }));
}

/** Displays an application-styled acknowledgement instead of a browser-native alert. */
export function appAlert(message: string, title = 'Notice'): Promise<void> {
  return presentDialog('alert', message, { title, confirmLabel: 'Okay' }, undefined);
}

/** Displays an application-styled confirmation and resolves false when cancelled. */
export function appConfirm(message: string, options: AppConfirmOptions = {}): Promise<boolean> {
  return presentDialog('confirm', message, options, false);
}

/** Displays an application-styled text prompt; cancellation resolves to null. */
export function appPrompt(message: string, options: AppPromptOptions = {}): Promise<string | null> {
  return presentDialog('prompt', message, options, null);
}

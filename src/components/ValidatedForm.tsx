"use client";

import { useEffect, useRef, useState, type FormEvent, type FormHTMLAttributes } from "react";
import {
  applyInvalidFields,
  applyServerFieldError,
  clearFieldInvalid,
  collectInvalidControls,
  customErrorForControl,
  fieldPlaceLabel,
  isFormControl,
  namedControl,
  nativeValidityMessage,
  relatedControl,
  scrollAndFocusFirstInvalid,
  type FieldProblem,
  type FormControl,
} from "@/lib/form-validation";

type ServerFormAction = (formData: FormData) => void | Promise<unknown>;

type ValidatedFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  initialError?: string;
  initialErrorField?: string;
  /** R56: every problem the server found, so they are all listed at once. */
  initialProblems?: FieldProblem[];
  action?: string | ServerFormAction;
};

type NativeSubmit = NonNullable<FormHTMLAttributes<HTMLFormElement>["onSubmit"]>;
type NativeSubmitEvent = NativeSubmit extends (event: infer Event) => unknown ? Event : never;

/** One line in the box at the top: which box, what is wrong, and whether it is still wrong. */
type Problem = { key: string; name: string; label: string; message: string; fixed: boolean; server: boolean };

/** Opens any folded section the box sits in, then takes staff to it. */
function goTo(control: HTMLElement) {
  let node: HTMLElement | null = control;
  while (node) {
    if (node instanceof HTMLDetailsElement && !node.open) node.open = true;
    node = node.parentElement;
  }
  scrollAndFocusFirstInvalid(control);
}

function problemKey(control: FormControl): string {
  return control.name || control.id || fieldPlaceLabel(control);
}

/**
 * R56: on save, every problem is listed at the top in plain words, each a link to its box, with "Next problem →"
 * and a count that goes down as each is fixed. When none are left the box says "All fixed – save now". The box takes
 * focus so a screen reader announces it. Nothing typed is lost (the draft keeps it, R54).
 */
export function ValidatedForm({
  children,
  initialError,
  initialErrorField,
  initialProblems,
  onSubmit,
  onInput,
  onChange,
  noValidate = true,
  action,
  method,
  encType,
  ...rest
}: ValidatedFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [problems, setProblems] = useState<Problem[]>([]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const fromServer: FieldProblem[] = initialProblems?.length
      ? initialProblems
      : initialErrorField
        ? [{ field: initialErrorField, message: initialError || "Check this field." }]
        : [];
    if (!fromServer.length) return;
    const listed: Problem[] = [];
    for (const item of fromServer) {
      const control = applyServerFieldError(form, item.field, item.message);
      listed.push({
        key: item.field,
        name: item.field,
        label: control ? fieldPlaceLabel(control) : "This form",
        message: item.message,
        fixed: false,
        server: true,
      });
    }
    setProblems(listed);
    window.setTimeout(() => boxRef.current?.focus(), 0);
  }, [initialError, initialErrorField, initialProblems]);

  /** Re-checks every listed problem: a client check clears when the box is valid; a server one when its box changes. */
  function refresh(form: HTMLFormElement, changedName?: string) {
    if (!problems.length) return;
    const invalid = new Set(collectInvalidControls(form).map(({ control }) => problemKey(control)));
    setProblems((current) =>
      current.map((problem) => {
        if (problem.server) return problem.fixed || problem.name !== changedName ? problem : { ...problem, fixed: true };
        return { ...problem, fixed: !invalid.has(problem.key) };
      }),
    );
  }

  function revalidate(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (!isFormControl(target) || !target.form) return;
    // R59: a typed value being put back after an error is not a fix.
    if (target.form.getAttribute("data-restoring") === "yes") return;
    const control = relatedControl(target, target.form);
    const custom = customErrorForControl(control, target.form);
    control.setCustomValidity(custom || "");
    if (control.validity.valid) {
      clearFieldInvalid(control);
    } else if (control.classList.contains("field-invalid") || control.getAttribute("aria-invalid") === "true") {
      applyInvalidFields([{ control, message: custom || nativeValidityMessage(control) }]);
    }
    refresh(target.form, control.name);
  }

  function handleSubmit(event: NativeSubmitEvent) {
    const invalid = collectInvalidControls(event.currentTarget);
    if (invalid.length) {
      event.preventDefault();
      applyInvalidFields(invalid);
      setProblems(
        invalid.map(({ control, message }) => ({
          key: problemKey(control),
          name: control.name,
          label: fieldPlaceLabel(control),
          message,
          fixed: false,
          server: false,
        })),
      );
      window.setTimeout(() => boxRef.current?.focus(), 0);
      return;
    }
    setProblems([]);
    onSubmit?.(event);
  }

  function controlFor(problem: Problem): HTMLElement | null {
    const form = formRef.current;
    if (!form || !problem.name) return null;
    return namedControl(form, problem.name);
  }

  function jump(problem: Problem) {
    const control = controlFor(problem);
    if (control) goTo(control);
  }

  /** The next problem still open after the box that has focus, wrapping round to the first. */
  function next() {
    const open = problems.filter((problem) => !problem.fixed);
    if (!open.length) return;
    const active = document.activeElement;
    const at = open.findIndex((problem) => controlFor(problem) === active);
    jump(open[(at + 1) % open.length]!);
  }

  const left = problems.filter((problem) => !problem.fixed).length;

  // A server action is a function. React then sets method and encoding itself, and warns if we set them too.
  const functionAction = typeof action === "function";
  const formAction = functionAction ? (action as (formData: FormData) => void | Promise<void>) : action;
  return (
    <form
      {...rest}
      action={formAction}
      {...(functionAction ? {} : { method, encType })}
      ref={(node) => {
        formRef.current = node;
      }}
      noValidate={noValidate}
      onSubmit={handleSubmit}
      onInput={(event) => {
        revalidate(event);
        onInput?.(event);
      }}
      onChange={(event) => {
        revalidate(event);
        onChange?.(event);
      }}
    >
      {problems.length ? (
        <div
          ref={boxRef}
          tabIndex={-1}
          role="alert"
          aria-live="assertive"
          data-form-error
          data-problems-left={left}
          className={`sticky top-20 z-20 rounded-md border px-4 py-3 text-sm outline-none sm:col-span-2 ${left ? "border-overdue/40 bg-[#f8ecec] text-overdue" : "border-ok/40 bg-[#eef6ee] text-ok"}`}
        >
          {left ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {problems.length === left
                    ? `${left} ${left === 1 ? "thing" : "things"} to fix before saving`
                    : `${left} left to fix before saving`}
                </p>
                <button type="button" onClick={next} className="min-h-10 rounded-md border border-overdue bg-white px-3 py-1.5 font-semibold text-overdue" data-next-problem>
                  Next problem →
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {problems.map((problem) =>
                  problem.fixed ? null : (
                    <li key={problem.key}>
                      <a
                        href={`#${problem.name}`}
                        onClick={(event) => {
                          event.preventDefault();
                          jump(problem);
                        }}
                        className="underline"
                        data-problem-link={problem.name}
                      >
                        {problem.label}: {problem.message}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </>
          ) : (
            <p className="font-semibold" data-all-fixed>
              All fixed – save now.
            </p>
          )}
        </div>
      ) : null}
      {children}
    </form>
  );
}

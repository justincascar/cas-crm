/** React types a form action as returning nothing. The same function still runs. */
export function asFormAction<Result>(
  action: (formData: FormData) => Result | Promise<Result>,
): (formData: FormData) => void | Promise<void> {
  return action as (formData: FormData) => void | Promise<void>;
}

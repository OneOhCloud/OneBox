import { useContext, useEffect, useState } from "react";
import { z } from "zod";
import { NavContext } from "../single/context";
import { t } from "../utils/helper";

export type ValidationErrors = {
    name?: string;
    url?: string;
};

const subscriptionSchema = z.object({
    name: z.string().optional(),
    url: z.url(t("please_input_valid_url")).min(1, t("url_cannot_empty")),
});

/**
 * Form-only state hook for the add-subscription modal.
 *
 * The submit handler hands the URL off to the apply=1 pipeline via
 * NavContext (`setActiveScreen('home')` + `setDeepLinkApplyUrl(url)`),
 * so manual add shares the deep-link modal UI and behaviour:
 *   init → import → start → done.
 *
 * There is no "loading" / "result" state here — Home's
 * DeepLinkApplyProgressModal owns the full post-submit flow.
 */
export function useModalState() {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [errors, setErrors] = useState<ValidationErrors>({});

    const {
        setDeepLinkApplyUrl,
        setDeepLinkApplyAutoStart,
        deepLinkUrl,
        setDeepLinkUrl,
    } = useContext(NavContext);

    function openModal(prefillUrl = '') {
        setName('');
        setUrl(prefillUrl);
        setErrors({});
        setOpen(true);
    }

    function closeModal() {
        setOpen(false);
    }

    // 收到 apply=0 的 deep link 时，自动预填 URL 并打开弹窗
    useEffect(() => {
        if (!deepLinkUrl) return;
        openModal(deepLinkUrl);
        setDeepLinkUrl('');
    }, [deepLinkUrl]);

    function validate(): boolean {
        try {
            subscriptionSchema.parse({ name, url });
            setErrors({});
            return true;
        } catch (err) {
            if (err instanceof z.ZodError) {
                const next: ValidationErrors = {};
                err.issues.forEach(issue => {
                    next[issue.path[0] as keyof ValidationErrors] = issue.message;
                });
                setErrors(next);
            }
            return false;
        }
    }

    function submit() {
        if (!validate()) return;
        const target = url;
        setOpen(false);
        // Manual add: same modal UI as apply=1, but stays on the current
        // page (no setActiveScreen). The apply pipeline must NOT touch
        // the engine and must NOT re-select SSI. Flag goes before the URL
        // so the consumer's render sees both updates in one batch.
        setDeepLinkApplyAutoStart(false);
        setDeepLinkApplyUrl(target);
    }

    function onNameChange(value: string) {
        setName(value);
        if (errors.name) validate();
    }

    function onUrlChange(value: string) {
        setUrl(value);
        if (errors.url) validate();
    }

    return { open, name, url, errors, openModal, closeModal, onNameChange, onUrlChange, submit };
}

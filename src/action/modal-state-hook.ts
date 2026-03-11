import { useContext, useEffect, useState } from "react";
import { mutate } from "swr";
import { z } from "zod";
import { NavContext } from "../single/context";
import { GET_SUBSCRIPTIONS_LIST_SWR_KEY } from "../types/definition";
import { t } from "../utils/helper";
import { useAddSubscription } from "./subscription-hooks";

export type Step = 'form' | 'loading' | 'result';

export type MessageType = 'success' | 'error' | 'warning' | undefined;

export type ValidationErrors = {
    name?: string;
    url?: string;
};

const subscriptionSchema = z.object({
    name: z.string().optional(),
    url: z.url(t("please_input_valid_url")).min(1, t("url_cannot_empty")),
});

export function useModalState() {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<Step>('form');
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [errors, setErrors] = useState<ValidationErrors>({});

    const { add, resetMessage, loading, message, messageType } = useAddSubscription();
    const { deepLinkUrl, setDeepLinkUrl } = useContext(NavContext);

    function openModal(prefillUrl = '') {
        setName('');
        setUrl(prefillUrl);
        setErrors({});
        setStep('form');
        resetMessage();
        setOpen(true);
    }

    function closeModal() {
        setOpen(false);
        setStep('form');
        resetMessage();
    }

    // 收到 deep link 时自动预填 URL 并打开弹窗
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

    async function submit() {
        if (!validate()) return;
        setStep('loading');
        await add(url, name);
        mutate(GET_SUBSCRIPTIONS_LIST_SWR_KEY);
        setStep('result');
    }

    function onNameChange(value: string) {
        setName(value);
        if (errors.name) validate();
    }

    function onUrlChange(value: string) {
        setUrl(value);
        if (errors.url) validate();
    }

    return { open, step, name, url, errors, message, messageType, loading, openModal, closeModal, onNameChange, onUrlChange, submit };
}

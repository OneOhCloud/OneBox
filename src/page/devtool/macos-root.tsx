import AuthDialog from "../../components/settings/auth-dialog";


export default function MacOSDevPage() {

    const handleAuthSuccess = () => {
        console.log("授权成功！");
        // 在这里处理授权成功后的逻辑
    };
    const handleClose = () => {
        console.log("关闭对话框");
        // 在这里处理关闭对话框后的逻辑
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <AuthDialog onAuthSuccess={handleAuthSuccess} open onClose={handleClose} />
        </div>
    );
}
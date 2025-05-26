import ToggleDev from "../components/developer/dev-toggle";
import StageSetting from "../components/developer/stage";

export default function Page() {
    return (
        <div className="bg-gray-50 overflow-y-auto h-[calc(100vh-40px)]">
            <div className="container mx-auto p-4 max-w-md  ">
                <div className="mb-6 rounded-xl overflow-hidden bg-white shadow-none">
                    <div className="divide-y divide-gray-50">
                        <ToggleDev />

                    </div>
                </div>

                <div className="rounded-xl overflow-hidden bg-white shadow-none ">
                    <div className="divide-y divide-gray-50">
                        <StageSetting />
                    </div>
                </div>

            </div>
        </div>
    )


}
use oneoh_sing_box_lib::vpn::privilege_controller;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    privilege_controller::main().map_err(|e| e.into())
}

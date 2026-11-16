import { Dialog } from "@headlessui/react";
import { usePlayers } from "frontend/context/players";
import DefaultDialogDesign from "../../layout/modal/DefaultDialogDesign";
import CreateLobby from "./CreateLobby";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

/** Create-match entry point: now spins up a lobby (pre-room) and routes the host into it. */
export default function CreateMatchModal({ isOpen, onClose }: Props) {
  const { currentPlayer } = usePlayers();

  return (
    <Dialog open={isOpen} onClose={onClose} className="@relative @z-40">
      <DefaultDialogDesign title="Create lobby" width="min(680px, 92vw)">
        <div className="@px-6 @py-6 smallscreen:@px-10">
          <CreateLobby currentPlayer={currentPlayer} onCreated={onClose} />
        </div>
      </DefaultDialogDesign>
    </Dialog>
  );
}

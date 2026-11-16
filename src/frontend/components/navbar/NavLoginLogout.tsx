import { useSession } from "next-auth/react";
import SquareButton from "../layout/SquareButton";
import LoginSignupModal from "../modals/LoginSignupModal";
import UserMenu from "./UserMenu";

type Props = {
  setIsOpen: (value: boolean, callbackUrl?: string) => Promise<void>;
  isOpen: boolean;
  width?: string;
};

export default function NavLoginLogout({ isOpen, setIsOpen, width }: Props) {
  const { data: session } = useSession();

  return (
    <div className="@flex @justify-center @items-center @h-full">
      {session?.user ? (
        <UserMenu />
      ) : (
        <>
          <div className="@w-32">
            <SquareButton
              onClick={() => {
                void setIsOpen(true);
              }}
            >
              LOGIN
            </SquareButton>
          </div>
          <LoginSignupModal isOpen={isOpen} setIsOpen={setIsOpen} width={width ?? "50vw"} />
        </>
      )}
    </div>
  );
}

import CurrentPlayerSelect from "./CurrentPlayerSelect";
import { NavItem } from "./NavItem";
import NavLoginLogout from "./NavLoginLogout";

type Props = {
  setIsOpen: (value: boolean, callbackUrl?: string) => Promise<void>;
  isOpen: boolean;
};

// The old single GAME link split in two: PLAY is how you start a game, YOUR GAMES is what you're
// already in. PLAY takes the slot COMPETITION held — that pointed at "/" and went nowhere.
const navItemObject = [
  { text: "PLAY", location: "/play" },
  { text: "YOUR GAMES", location: "/your-games" },
  {
    text: "NEWS",
    location: "/news",
    iconPath: "/img/layout/Sub-0.png",
    iconAlt: "Yellow Comet Sub",
    flip: false,
  },
  {
    text: "HOW TO PLAY",
    location: "/howtoplay",
    iconPath: "/img/layout/APC_MSide-0.png",
    iconAlt: "Jade Sun APC",
    flip: true,
  },
  {
    text: "COMMUNITY",
    location: "/social",
    iconPath: "/img/layout/Cruiser-0.png",
    iconAlt: "Blue Moon Cruiser",
    flip: false,
  },
];

export function NavGroup({ setIsOpen, isOpen }: Props) {
  return (
    <>
      <div className="@flex @items-center @justify-center @gap-10 monitor:@gap-16 @h-full @w-[70vw]">
        {navItemObject.map((item) => (
          <NavItem key={item.text} text={item.text} location={item.location} />
        ))}
      </div>
      <div className="@flex @h-12 @w-[15%] @justify-end @items-center @relative @gap-3">
        <CurrentPlayerSelect />
        <NavLoginLogout isOpen={isOpen} setIsOpen={setIsOpen} />
      </div>
    </>
  );
}

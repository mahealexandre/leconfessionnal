import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { WaitingRoom } from "@/components/room/WaitingRoom";
import { ActionForm } from "@/components/room/ActionForm";
import { GameRound } from "@/components/room/GameRound";
import { Player } from "@/types/game";

const Room = () => {
  const { code } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [players, setPlayers] = useState<Player[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState("waiting");
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [actions, setActions] = useState<any[]>([]);
  const [remainingActions, setRemainingActions] = useState<any[]>([]);

  useEffect(() => {
    const fetchRoom = async () => {
      try {
        // Fetch room data
        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .select()
          .eq("code", code)
          .single();

        if (roomError) throw roomError;
        
        setRoomId(room.id);
        setRoomStatus(room.status);

        // Get stored username
        const storedUsername = localStorage.getItem('username');
        console.log("Stored username:", storedUsername);

        // Fetch players in room
        const { data: playersData, error: playersError } = await supabase
          .from("players")
          .select()
          .eq("room_id", room.id);

        if (playersError) throw playersError;

        setPlayers(playersData);
        
        // Find the player with matching username
        const currentPlayer = playersData.find(p => p.username === storedUsername);
        
        if (currentPlayer) {
          console.log("Found player:", currentPlayer);
          localStorage.setItem(`player_id_${room.id}`, currentPlayer.id);
          setCurrentPlayerId(currentPlayer.id);
        } else {
          console.log("No matching player found for username:", storedUsername);
        }

        // Only fetch actions if room is in playing state
        if (room.status === "playing") {
          const { data: actionsData, error: actionsError } = await supabase
            .from("player_actions")
            .select()
            .eq("room_id", room.id);

          if (actionsError) throw actionsError;
          if (actionsData) {
            setActions(actionsData);
            setRemainingActions(actionsData);
          }
        }
      } catch (error) {
        console.error("Error fetching room:", error);
        toast({
          variant: "destructive",
          title: "Erreur",
          description: "Impossible de rejoindre la salle.",
        });
        navigate("/");
      }
    };

    if (code) {
      fetchRoom();
    }

    const channel = supabase
      .channel("room_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newPlayer = payload.new as Player;
            setPlayers((current) => [...current, newPlayer]);
            
            // If this is our player, save the ID
            const storedUsername = localStorage.getItem('username');
            if (storedUsername === newPlayer.username) {
              console.log("Saving player ID for new player:", newPlayer.id);
              localStorage.setItem(`player_id_${roomId}`, newPlayer.id);
              setCurrentPlayerId(newPlayer.id);
            }
          } else if (payload.eventType === "UPDATE") {
            setPlayers((current) =>
              current.map((player) =>
                player.id === payload.new.id ? { ...player, ...payload.new } : player
              )
            );
          } else if (payload.eventType === "DELETE") {
            setPlayers((current) =>
              current.filter((player) => player.id !== payload.old.id)
            );
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.new.status !== roomStatus) {
            setRoomStatus(payload.new.status);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code, navigate, roomId, toast, roomStatus]);

  const startGame = async () => {
    if (!roomId) return;
    
    try {
      const { error } = await supabase
        .from("rooms")
        .update({ status: "playing" })
        .eq("id", roomId);

      if (error) throw error;

      toast({
        title: "Partie lancée !",
        description: "Tous les joueurs peuvent maintenant saisir leurs actions.",
      });
    } catch (error) {
      console.error("Error starting game:", error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de lancer la partie.",
      });
    }
  };

  const onSubmit = async (values: { actions: string[] }) => {
    console.log("Starting onSubmit with values:", values);
    console.log("Current player ID:", currentPlayerId);
    console.log("Room ID:", roomId);

    if (!currentPlayerId || !roomId) {
      console.error("Missing currentPlayerId or roomId:", { currentPlayerId, roomId });
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Une erreur est survenue lors de la soumission des actions.",
      });
      return;
    }

    try {
      const actionsToInsert = values.actions.map(action => ({
        player_id: currentPlayerId,
        room_id: roomId,
        action_text: action
      }));

      console.log("Inserting actions:", actionsToInsert);

      const { error: insertError } = await supabase
        .from("player_actions")
        .insert(actionsToInsert);

      if (insertError) {
        console.error("Error inserting actions:", insertError);
        throw insertError;
      }

      console.log("Actions inserted successfully");

      const { error: updateError } = await supabase
        .from("players")
        .update({ has_submitted: true })
        .eq("id", currentPlayerId);

      if (updateError) {
        console.error("Error updating player status:", updateError);
        throw updateError;
      }

      console.log("Player status updated successfully");

      toast({
        title: "Actions soumises !",
        description: "Vos actions ont été enregistrées avec succès.",
      });
    } catch (error) {
      console.error("Error in onSubmit:", error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Une erreur est survenue lors de la soumission des actions.",
      });
    }
  };

  const handleNextRound = () => {
    if (remainingActions.length > 0) {
      setRemainingActions((current) => current.slice(1));
    } else {
      toast({
        title: "Partie terminée !",
        description: "Toutes les actions ont été réalisées.",
      });
      navigate("/");
    }
  };

  useEffect(() => {
    const submittedPlayers = players.filter((p) => p.has_submitted).length;
    setSubmittedCount(submittedPlayers);
  }, [players]);

  const currentPlayer = players.find((p) => p.id === currentPlayerId);

  if (roomStatus === "waiting") {
    return <WaitingRoom code={code || ""} players={players} onStartGame={startGame} />;
  }

  if (roomStatus === "playing" && !currentPlayer?.has_submitted) {
    return (
      <ActionForm
        onSubmit={onSubmit}
        submittedCount={submittedCount}
        totalPlayers={players.length}
      />
    );
  }

  return (
    <GameRound
      players={players}
      actions={remainingActions}
      onNextRound={handleNextRound}
    />
  );
};

export default Room;

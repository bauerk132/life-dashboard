function getUpcomingEvents_() {
  try {
    const end = new Date();
    end.setDate(end.getDate() + 7);
    return CalendarApp.getDefaultCalendar().getEvents(new Date(), end)
      .slice(0, 6)
      .map(function(event) {
        return {
          title: event.getTitle(),
          start: event.getStartTime().toISOString(),
          end: event.getEndTime().toISOString(),
          allDay: event.isAllDayEvent()
        };
      });
  } catch (error) {
    // Calendar authorization is optional; a dashboard should still load without it.
    return [];
  }
}
